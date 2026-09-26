import Order, { ORDER_STATUSES, PAYMENT_STATUSES } from "../models/Order.js";
import Product from "../models/Product.js";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { generateOrderNumber } from "../utils/generateOrderNumber.js";
import { createInvoiceForOrder } from "./invoiceService.js";
import { notifyAdmins, notifyUser, logActivity } from "./notificationService.js";
import { uploadBuffer } from "./cloudinaryService.js";

/**
 * Creates a wholesale order
 */
export const createOrder = async ({ customerId, items, deliveryFee = 0, notes = "" }) => {
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

  const orderNumber = generateOrderNumber();
  const totalAmount = subtotal + Number(deliveryFee);

  const order = await Order.create({
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

  return { order, invoice, chat };
};

/**
 * Customer uploads payment screenshot
 */
export const submitPaymentScreenshot = async ({ orderId, customerId, fileBuffer }) => {
  const order = await Order.findOne({ _id: orderId, customer: customerId });
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
