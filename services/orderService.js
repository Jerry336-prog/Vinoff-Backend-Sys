import mongoose from "mongoose";
import Order, { ORDER_STATUSES, PAYMENT_STATUSES } from "../models/Order.js";
import Product from "../models/Product.js";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import Setting from "../models/Setting.js";
import { generateOrderNumber } from "../utils/generateOrderNumber.js";
import { createInvoiceForOrder } from "./invoiceService.js";
import { notifyAdmins, notifyUser, logActivity } from "./notificationService.js";
import { sendOrderAlertEmail } from "./emailService.js";
import { uploadBuffer } from "./cloudinaryService.js";

const reserveInventory = async (requirements, productMap) => {
  const appliedAdjustments = [];

  try {
    // Pre-flight check: verify sufficient stock before touching the DB
    for (const requirement of requirements.values()) {
      const product = productMap.get(requirement.productId);
      const available = Number(product?.[requirement.field] ?? 0);
      const label = requirement.field === "stock" ? "carton" : "loose-unit";

      if (available < requirement.quantity) {
        throw new Error(
          `Insufficient ${label} stock for '${product?.name || "product"}'. ` +
            `Available: ${available}, requested: ${requirement.quantity}.`
        );
      }
    }

    // Apply deductions directly in the DB
    for (const requirement of requirements.values()) {
      const product = productMap.get(requirement.productId);

      const updatedProduct = await Product.findOneAndUpdate(
        { _id: requirement.productId },
        { $inc: { [requirement.field]: -requirement.quantity } },
        { new: true }
      );

      if (!updatedProduct) {
        throw new Error(
          `Product '${product?.name || "product"}' not found during stock deduction.`
        );
      }

      appliedAdjustments.push(requirement);
    }
  } catch (error) {
    // Rollback all already-applied deductions
    await Promise.all(
      appliedAdjustments.map((adj) =>
        Product.updateOne(
          { _id: adj.productId },
          { $inc: { [adj.field]: adj.quantity } }
        )
      )
    );
    throw error;
  }

  // Check low-stock alert thresholds
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

  return appliedAdjustments;
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
export const createOrder = async ({ customerId, items, deliveryFee = 0, notes = "" }) => {
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

    const quantity = parseInt(item.quantity, 10);
    if (!quantity || quantity < 1) {
      throw new Error(
        `Quantity for '${product.name}' must be at least 1`
      );
    }

    const isCarton = item.isCarton !== false && item.unitType !== "pieces" && item.unitType !== "units";
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
    inventoryRequirements.set(inventoryKey, {
      productId: product._id.toString(),
      field: inventoryField,
      label: isCarton ? "carton" : "loose-unit",
      quantity: (existingRequirement?.quantity || 0) + quantity,
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
    });
  }

  const inventoryAdjustments = await reserveInventory(inventoryRequirements, productMap);
  const orderNumber = generateOrderNumber();
  const totalAmount = subtotal + Number(deliveryFee);
  let order;

  try {
    order = await Order.create({
      orderNumber,
      customer: customerId,
      items: processedItems,
      subtotal,
      deliveryFee: Number(deliveryFee),
      totalAmount,
      status: "Pending Payment",
      paymentStatus: "Pending",
      notes,
    });
  } catch (error) {
    await restoreInventory(inventoryAdjustments);
    throw error;
  }

  // Automatically create invoice
  const invoice = await createInvoiceForOrder(order);
  order.invoice = invoice._id;
  await order.save();

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
    content: `Order #${orderNumber} created. Total amount: ₦${totalAmount.toLocaleString()}. Please upload your payment screenshot to proceed.`,
  });

  // Notify Admins
  await notifyAdmins({
    type: "NEW_ORDER",
    title: "New Wholesale Order",
    message: `${customer.firstName} ${customer.lastName} placed Order #${orderNumber} (₦${totalAmount.toLocaleString()})`,
    relatedUser: customerId,
    relatedOrder: order._id,
    relatedInvoice: invoice._id,
    relatedChat: chat._id,
  });

  // Log Activity
  await logActivity({
    actorId: customerId,
    action: "Customer created order",
    targetType: "Order",
    targetId: order._id,
    description: `Customer placed order #${orderNumber}`,
    metadata: { orderNumber, totalAmount, itemsCount: processedItems.length },
  });

  // Automated WhatsApp alert dispatch if enabled in Notification Preferences
  let whatsappUrl = null;
  let whatsappNumber = null;
  try {
    const notificationSetting = await Setting.findOne({ key: "notification_preferences" });
    const prefs = notificationSetting?.value || {};
    if (prefs.whatsappNotificationsEnabled && prefs.whatsappNumber) {
      let cleanPhone = prefs.whatsappNumber.replace(/[^0-9]/g, "");
      // Convert Nigerian local 080... format to international 23480...
      if (cleanPhone.startsWith("0") && cleanPhone.length === 11) {
        cleanPhone = `234${cleanPhone.slice(1)}`;
      } else if (!cleanPhone.startsWith("234") && cleanPhone.length === 10) {
        cleanPhone = `234${cleanPhone}`;
      }

      whatsappNumber = cleanPhone;

      const itemsSummary = processedItems
        .slice(0, 5)
        .map((it) => `• ${it.name} (${it.quantity} ${it.unitType || "ctns"})`)
        .join("\n");
      const moreItems = processedItems.length > 5 ? `\n...and ${processedItems.length - 5} more item(s)` : "";

      const waText =
        `*📦 NEW WHOLESALE ORDER ALERT - VINOFF*\n\n` +
        `*Order Number:* #${orderNumber}\n` +
        `*Customer:* ${customer.firstName} ${customer.lastName}\n` +
        `*Phone:* ${customer.phone || "Not specified"}\n` +
        `*Total Amount:* ₦${totalAmount.toLocaleString()}\n` +
        `*Items (${processedItems.length}):*\n${itemsSummary}${moreItems}\n\n` +
        `*Status:* Pending Payment / Invoice Issued\n` +
        `Check admin dashboard to verify payment or dispatch items.`;

      whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(waText)}`;

      await logActivity({
        actorId: customerId,
        action: "WhatsApp Order Notification Prepared",
        targetType: "Order",
        targetId: order._id,
        description: `WhatsApp notification dispatch link generated for store owner (${cleanPhone})`,
        metadata: {
          whatsappNumber: cleanPhone,
          whatsappUrl,
          orderNumber,
        },
      });
    }
  } catch (err) {
    console.error("[WhatsApp Notification Error]:", err.message);
  }

  // Instant Email Ping to Store Owner and Admins (non-blocking async background)
  sendOrderAlertEmail({
    orderNumber,
    customerName: `${customer.firstName} ${customer.lastName}`,
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
    whatsappUrl,
    whatsappNumber,
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

  // Update associated invoice to 'Paid' (Draft, Pending, Paid, Cancelled ONLY)
  if (order.invoice) {
    const Invoice = (await import("../models/Invoice.js")).default;
    await Invoice.findByIdAndUpdate(order.invoice, { status: "Paid" });
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
