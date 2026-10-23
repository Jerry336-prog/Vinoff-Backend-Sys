import mongoose from "mongoose";
import Order, { ORDER_STATUSES, PAYMENT_STATUSES } from "../models/Order.js";
import Product from "../models/Product.js";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import Setting from "../models/Setting.js";
import { generateOrderNumber } from "../utils/generateOrderNumber.js";
import { createInvoiceForOrder, recalculateCustomerCredit } from "./invoiceService.js";
import { notifyAdmins, notifyUser, logActivity } from "./notificationService.js";
import { sendOrderAlertEmail } from "./emailService.js";
import { uploadBuffer } from "./cloudinaryService.js";
import { withCreditTransaction } from './creditControlService.js';
import { creditError } from '../utils/creditPolicy.js';

const reserveInventory = async (requirements, productMap, session) => {
  const appliedAdjustments = [];

  try {
    // Pre-flight check: verify sufficient stock before touching the DB
    for (const requirement of requirements.values()) {
      const product = productMap.get(requirement.productId);
      const available = Number(product?.[requirement.field] ?? 0);
      const label = requirement.field === "carton" || requirement.field === "stock" ? "carton" : "loose-unit";

      if (available < requirement.quantity) {
        throw creditError(
          `Insufficient ${label} stock for '${product?.name || "product"}'. ` +
            `Available: ${available}, requested: ${requirement.quantity}.`, 409
        );
      }
    }

    // Apply deductions directly in the DB
    for (const requirement of requirements.values()) {
      const product = productMap.get(requirement.productId);

      const updatedProduct = await Product.findOneAndUpdate(
        { _id: requirement.productId, status: 'active', [requirement.field]: { $gte: requirement.quantity } },
        { $inc: { [requirement.field]: -requirement.quantity } },
        { returnDocument: 'after', session }
      );

      if (!updatedProduct) {
        throw creditError(
          `Product '${product?.name || "product"}' is unavailable or no longer has sufficient stock.`, 409
        );
      }

      appliedAdjustments.push(requirement);
    }
  } catch (error) {
    // Rollback all already-applied deductions
    if (!session) await Promise.all(
      appliedAdjustments.map((adj) =>
        Product.updateOne(
          { _id: adj.productId },
          { $inc: { [adj.field]: adj.quantity } }
        )
      )
    );
    throw error;
  }

  return appliedAdjustments;
};

const checkLowStock = async requirements => {
  // Check thresholds only after inventory and order commit successfully.
  try {
    const notificationSetting = await Setting.findOne({ key: "notification_preferences" });
    const prefs = notificationSetting?.value || {};
    if (prefs.lowStockAlertsEnabled !== false) {
      const globalThreshold = Number(prefs.lowStockThreshold) >= 0 ? Number(prefs.lowStockThreshold) : 5;
      const categoryThresholds = prefs.categoryThresholds || {};

      for (const requirement of requirements.values()) {
        const currentProd = await Product.findById(requirement.productId).select("name stock category");
        if (currentProd) {
          const threshold =
            categoryThresholds[currentProd.category] !== undefined
              ? Number(categoryThresholds[currentProd.category])
              : globalThreshold;

          if (currentProd.stock <= threshold) {
            await notifyAdmins({
              type: "LOW_STOCK",
              title: "⚠️ Low Stock Alert",
              message: `Product '${currentProd.name}' (${currentProd.category || "General"}) has dropped to ${currentProd.stock} carton(s) remaining (Alert threshold: ${threshold} cartons). Please restock soon.`,
              relatedProduct: currentProd._id,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("[Low Stock Alert Check Error]:", err.message);
  }

};

const restoreInventory = async (adjustments) => {
  await Promise.all(
    adjustments.map((adjustment) =>
      Product.updateOne(
        { _id: adjustment.productId },
        { $inc: { [adjustment.field]: adjustment.quantity } }
      )
    )
  );
};

/**
 * Creates a wholesale order
 */
export const createOrder = async ({
  customerId,
  items,
  deliveryFee = 0,
  notes = "",
  isCreditOrder = false,
  paymentMethod = "paystack",
}) => {
  // Check store status / vacation mode
  const storeStatusSetting = await Setting.findOne({ key: "store_status" });
  if (storeStatusSetting && storeStatusSetting.value?.isOpen === false) {
    const notice =
      storeStatusSetting.value.bannerMessage ||
      "We are currently restocking our warehouse for the weekend. Orders placed today will be dispatched Monday.";
    throw new Error(`The store is temporarily closed for orders / stock-taking. ${notice}`);
  }

  if (!items || !items.length) {
    throw new Error("Order must have at least one item");
  }

  const customer = await User.findById(customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }

  const useVipCredit = Boolean(isCreditOrder || paymentMethod === "credit");
  if (useVipCredit && !customer.isVipCreditPartner) {
    throw new Error(
      "Only approved VIP Credit Partners are eligible to place wholesale orders on credit."
    );
  }

  const productIds = items.map((i) => i.productId || i.product);
  const products = await Product.find({ _id: { $in: productIds } });
  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  let subtotal = 0;
  const processedItems = [];
  const inventoryRequirements = new Map();

  for (const item of items) {
    const pId = (item.productId || item.product).toString();
    const product = productMap.get(pId);

    if (!product) {
      throw new Error(`Product not found with ID: ${pId}`);
    }

    if (product.status !== "active") {
      throw new Error(`Product '${product.name}' is currently unavailable`);
    }

    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error(
        `Quantity for '${product.name}' must be at least 1`
      );
    }

    const isCarton = item.isCarton !== false && item.unitType !== "pieces" && item.unitType !== "units";
    if ((isCarton && product.allowCarton === false) || (!isCarton && product.allowPieces === false)) throw creditError(`This purchase format is not available for ${product.name}.`, 409);
    const cartonPrice = Number(product.wholesalePrice || product.price || 0);
    const unitsPerCarton = Number(product.unitsPerCarton || product.minimumQuantity || 12);
    const piecePrice = Number(product.piecePrice || product.unitPrice || Math.round(cartonPrice / unitsPerCarton));

    const unitPrice = isCarton ? cartonPrice : piecePrice;
    const unitType = isCarton ? "cartons" : "pieces";
    const tag = isCarton ? "(CTN)" : "(Pieces)";

    let baseName = product.name || "Commercial Product";
    baseName = baseName.replace(/\s*\((CTN|Pieces|ctn|pieces|Units|units)\)\s*$/i, "").trim();
    const displayName = `${baseName} ${tag}`;

    const itemSubtotal = unitPrice * quantity;
    subtotal += itemSubtotal;

    const inventoryField = isCarton ? "stock" : "unitStock";
    const inventoryKey = `${product._id}:${inventoryField}`;
    const existingRequirement = inventoryRequirements.get(inventoryKey);
    const startingStock = Number(product?.[inventoryField] ?? 0);
    const prevAccumulated = existingRequirement?.quantity || 0;
    const itemPreviousStock = Math.max(0, startingStock - prevAccumulated);
    const itemNewStock = Math.max(0, itemPreviousStock - quantity);

    inventoryRequirements.set(inventoryKey, {
      productId: product._id.toString(),
      field: inventoryField,
      label: isCarton ? "carton" : "loose-unit",
      quantity: prevAccumulated + quantity,
    });

    processedItems.push({
      product: product._id,
      name: displayName,
      price: unitPrice,
      wholesalePrice: cartonPrice,
      quantity,
      subtotal: itemSubtotal,
      unit: unitType,
      isCarton,
      unitType,
      image: product.images?.[0]?.url || "",
      previousStock: itemPreviousStock,
      newStock: itemNewStock,
    });
  }

  const orderNumber = generateOrderNumber();
  if (!Number.isFinite(Number(deliveryFee)) || Number(deliveryFee) < 0) throw creditError('Invalid delivery fee.');
  const totalAmount = Math.round((subtotal + Number(deliveryFee)) * 100) / 100;
  if (!Number.isSafeInteger(Math.round(totalAmount * 100))) throw creditError('Invalid order total.');
  const { order, invoice } = await withCreditTransaction(customerId, async session => {
    await reserveInventory(inventoryRequirements, productMap, session);
    const [order] = await Order.create([{
      orderNumber,
      customer: customerId,
      items: processedItems,
      subtotal,
      deliveryFee: Number(deliveryFee),
      totalAmount,
      status: useVipCredit ? "Processing" : "Pending Payment",
      paymentStatus: useVipCredit ? "On Credit" : "Pending",
      isCreditOrder: useVipCredit,
      paymentMethod: useVipCredit ? "credit" : "paystack",
      notes,
    }], { session });
    const invoice = await createInvoiceForOrder(order, session);
    order.invoice = invoice._id;
    await order.save({ session });
    return { order, invoice };
  });
  await checkLowStock(inventoryRequirements);

  // Create or link chat for customer support / order messaging ("Message Admin")
  const chatTitle = `${customer.firstName} ${customer.lastName} — Order #${orderNumber}`;
  let chat = await Chat.findOne({ customer: customerId, order: order._id });
  if (!chat) {
    chat = await Chat.create({
      customer: customerId,
      order: order._id,
      title: chatTitle,
      status: "open",
    });
  }

  // System message in chat
  await Message.create({
    chat: chat._id,
    senderRole: "system",
    content: useVipCredit
      ? `VIP Credit Order #${orderNumber} placed on credit. Total credit amount: ₦${totalAmount.toLocaleString()} (Invoice #${invoice.invoiceNumber}).`
      : `Order #${orderNumber} created. Total amount: ₦${totalAmount.toLocaleString()}. Pay securely with Paystack from checkout or your order page. Payment is confirmed automatically.`,
  });

  // Notify Admins
  await notifyAdmins({
    type: "NEW_ORDER",
    title: useVipCredit ? "New VIP Credit Order" : "New Wholesale Order",
    message: `${customer.firstName} ${customer.lastName} placed ${useVipCredit ? "Credit " : ""}Order #${orderNumber} (₦${totalAmount.toLocaleString()})`,
    relatedUser: customerId,
    relatedOrder: order._id,
    relatedInvoice: invoice._id,
    relatedChat: chat._id,
  });

  // Log Activity
  await logActivity({
    actorId: customerId,
    action: useVipCredit ? "VIP Customer placed credit order" : "Customer created order",
    targetType: "Order",
    targetId: order._id,
    description: `Customer placed ${useVipCredit ? "VIP credit " : ""}order #${orderNumber}`,
    metadata: {
      orderNumber,
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount,
      itemsCount: processedItems.length,
      isCreditOrder: useVipCredit,
      stockMovements: processedItems.map((it) => ({
        productId: it.product,
        productName: it.name,
        quantity: it.quantity,
        change: -it.quantity,
        unitType: it.isCarton ? "cartons" : "units",
        previousStock: it.previousStock,
        newStock: it.newStock,
      })),
    },
  });

  // Instant Email Ping to Store Owner and Admins (non-blocking async background)
  sendOrderAlertEmail({
    orderNumber,
    customerName: `${customer.firstName} ${customer.lastName}${useVipCredit ? " (VIP Credit)" : ""}`,
    phone: customer.phone,
    totalAmount,
    itemsCount: processedItems.length,
    items: processedItems,
  }).catch((emailErr) => {
    console.error("[Order Email Dispatch Error]:", emailErr.message);
  });

  return {
    order,
    invoice,
    chat,
  };
};

/**
 * Customer uploads payment screenshot
 */
export const submitPaymentScreenshot = async ({ orderId, customerId, fileBuffer }) => {
  const isObjectId = mongoose.isValidObjectId(orderId);
  const query = isObjectId
    ? { _id: orderId, customer: customerId }
    : { orderNumber: orderId, customer: customerId };
  const order = await Order.findOne(query);
  if (!order) {
    throw new Error("Order not found or access denied");
  }

  if (order.paymentStatus === "Confirmed") {
    throw new Error("Payment has already been confirmed for this order");
  }

  // Upload to Cloudinary
  const uploadResult = await uploadBuffer(fileBuffer, "vinoff_payments");

  order.paymentScreenshot = {
    url: uploadResult.url,
    publicId: uploadResult.publicId,
    uploadedAt: new Date(),
  };
  order.paymentStatus = "Submitted";
  order.status = "Awaiting Confirmation";
  await order.save();

  // Notify admins
  const customer = await User.findById(customerId);
  const customerName = customer ? `${customer.firstName} ${customer.lastName}` : "Customer";

  await notifyAdmins({
    type: "PAYMENT_UPLOADED",
    title: "Payment Screenshot Submitted",
    message: `${customerName} submitted payment proof for Order #${order.orderNumber}`,
    relatedUser: customerId,
    relatedOrder: order._id,
    relatedInvoice: order.invoice,
  });

  // Find or create chat to append system message
  let chat = await Chat.findOne({ order: order._id });
  if (chat) {
    await Message.create({
      chat: chat._id,
      senderRole: "system",
      content: `Customer submitted payment screenshot for Order #${order.orderNumber}. Awaiting admin confirmation.`,
      attachments: [
        {
          url: uploadResult.url,
          type: "image",
          publicId: uploadResult.publicId,
        },
      ],
    });
    chat.lastMessage = "Payment screenshot uploaded";
    chat.lastMessageAt = new Date();
    chat.unreadForAdmin += 1;
    await chat.save();
  }

  // Log activity
  await logActivity({
    actorId: customerId,
    action: "Customer uploaded payment screenshot",
    targetType: "Order",
    targetId: order._id,
    description: `Payment screenshot uploaded for Order #${order.orderNumber}`,
    metadata: { orderNumber: order.orderNumber, screenshotUrl: uploadResult.url },
  });

  return order;
};

/**
 * Admin confirms payment for an order
 */
export const confirmPayment = async (orderId, adminId) => {
  const order = await Order.findById(orderId).populate("customer", "firstName lastName email");
  if (!order) {
    throw new Error("Order not found");
  }

  order.paymentStatus = "Confirmed";
  order.status = "Payment Confirmed";
  await order.save();

  // Update associated invoice to 'Paid' and settle credit if applicable
  if (order.invoice) {
    const Invoice = (await import("../models/Invoice.js")).default;
    const inv = await Invoice.findById(order.invoice);
    if (inv) {
      inv.status = "Paid";
      if (inv.isCredit || order.isCreditOrder) {
        inv.isCredit = true;
        inv.creditSettledAt = new Date();
      }
      await inv.save();
    }
  }

  // Recalculate customer's outstanding credit balance
  if (order.customer?._id || order.customer) {
    await recalculateCustomerCredit(order.customer?._id || order.customer);
  }

  // Notify customer
  await notifyUser({
    recipientId: order.customer._id,
    type: "ORDER_STATUS_CHANGED",
    title: "Payment Confirmed",
    message: `Your payment for Order #${order.orderNumber} has been verified and confirmed!`,
    relatedOrder: order._id,
    relatedInvoice: order.invoice,
  });

  // Post system message in chat
  const chat = await Chat.findOne({ order: order._id });
  if (chat) {
    await Message.create({
      chat: chat._id,
      senderRole: "system",
      content: `Admin confirmed payment for Order #${order.orderNumber}. Status updated to 'Payment Confirmed'.`,
    });
    chat.lastMessage = "Payment confirmed by admin";
    chat.lastMessageAt = new Date();
    chat.unreadForCustomer += 1;
    await chat.save();
  }

  // Log activity
  await logActivity({
    actorId: adminId,
    action: "Admin confirmed payment",
    targetType: "Order",
    targetId: order._id,
    description: `Admin confirmed payment for Order #${order.orderNumber}`,
    metadata: { orderNumber: order.orderNumber, totalAmount: order.totalAmount },
  });

  return order;
};

/**
 * Update order status
 */
export const updateOrderStatus = async (orderId, newStatus, adminId) => {
  if (!['Processing', 'Delivered', 'Cancelled'].includes(newStatus)) {
    throw new Error('Choose Processing, Delivered, or Cancelled. Payment is confirmed automatically.');
  }
  if (!ORDER_STATUSES.includes(newStatus)) {
    throw new Error(
      `Invalid order status: '${newStatus}'. Allowed statuses: ${ORDER_STATUSES.join(", ")}`
    );
  }

  const order = await Order.findById(orderId);
  if (!order) {
    throw new Error("Order not found");
  }

  const prevStatus = order.status;
  if (newStatus !== 'Cancelled' && order.paymentStatus !== 'Confirmed' && !order.isCreditOrder) {
    throw new Error('Payment must be verified before processing or delivery.');
  }
  if (['Delivered', 'Completed'].includes(prevStatus) && newStatus !== 'Delivered') {
    throw new Error('A delivered order cannot move backwards.');
  }
  order.status = newStatus;
  await order.save();

  // Notify customer
  await notifyUser({
    recipientId: order.customer,
    type: "ORDER_STATUS_CHANGED",
    title: "Order Status Updated",
    message: `Your Order #${order.orderNumber} status was changed to '${newStatus}'`,
    relatedOrder: order._id,
  });

  // Post system message in chat
  const chat = await Chat.findOne({ order: order._id });
  if (chat) {
    await Message.create({
      chat: chat._id,
      senderRole: "system",
      content: `Order status changed from '${prevStatus}' to '${newStatus}'.`,
    });
    chat.lastMessage = `Order status: ${newStatus}`;
    chat.lastMessageAt = new Date();
    chat.unreadForCustomer += 1;
    await chat.save();
  }

  // Log activity
  await logActivity({
    actorId: adminId,
    action: "Admin changed order status",
    targetType: "Order",
    targetId: order._id,
    description: `Order #${order.orderNumber} status changed from ${prevStatus} to ${newStatus}`,
    metadata: { prevStatus, newStatus },
  });

  return order;
};

export default {
  createOrder,
  submitPaymentScreenshot,
  confirmPayment,
  updateOrderStatus,
};
