import Chat from "../models/Chat.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import Message from "../models/Message.js";
import { getPagination, formatPaginatedResponse } from "../utils/pagination.js";
import { successResponse, errorResponse } from "../utils/response.js";

const CUSTOMER_POPULATE = "firstName lastName email phone role profile";

const normalizeChatStatus = (status) => {
  const raw = String(status || "open").trim();
  const map = {
    open: "open",
    Open: "open",
    awaiting_invoice: "awaiting_invoice",
    "Awaiting Invoice": "awaiting_invoice",
    awaiting_payment: "awaiting_payment",
    "Awaiting Payment Confirmation": "awaiting_payment",
    closed: "closed",
    Closed: "closed",
    Resolved: "closed",
    resolved: "closed",
  };
  return map[raw] || raw.toLowerCase().replace(/\s+/g, "_");
};

/**
 * Create or get an existing chat
 * POST /api/chats
 */
export const createOrGetChat = async (req, res, next) => {
  try {
    const { orderId, title } = req.body;
    const customerId = req.user.role === "customer" ? req.user._id : req.body.customerId;

    if (!customerId) {
      return errorResponse(res, 400, "Customer ID is required");
    }

    const customer = await User.findById(customerId);
    if (!customer) {
      return errorResponse(res, 404, "Customer not found");
    }

    let chat = await Chat.findOne({ customer: customerId })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .populate("customer", CUSTOMER_POPULATE)
      .populate("order", "orderNumber status totalAmount");

    if (!chat) {
      let chatTitle = title || `Message Admin — ${customer.firstName} ${customer.lastName}`;
      if (orderId) {
        const order = await Order.findById(orderId);
        if (order) {
          chatTitle = `${customer.firstName} ${customer.lastName} — Order #${order.orderNumber}`;
        }
      }

      chat = await Chat.create({
        customer: customerId,
        order: orderId || null,
        title: chatTitle,
        status: "open",
      });

      chat = await Chat.findById(chat._id)
        .populate("customer", CUSTOMER_POPULATE)
        .populate("order", "orderNumber status totalAmount");
    } else if (orderId && !chat.order) {
      chat.order = orderId;
      await chat.save();
      chat = await Chat.findById(chat._id)
        .populate("customer", CUSTOMER_POPULATE)
        .populate("order", "orderNumber status totalAmount");
    }

    return successResponse(res, 200, "Chat session retrieved", chat);
  } catch (error) {
    next(error);
  }
};

/**
 * Get all chats for current user (customer or admin)
 * GET /api/chats
 */
export const getChats = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req, 100);
    const { status } = req.query;

    const query = {};
    if (req.user.role === "customer") {
      query.customer = req.user._id;
    }

    if (status) {
      query.status = normalizeChatStatus(status);
    }

    const [chats, totalCount] = await Promise.all([
      Chat.find(query)
        .populate("customer", CUSTOMER_POPULATE)
        .populate("order", "orderNumber status totalAmount")
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      Chat.countDocuments(query),
    ]);

    // Deduplicate rooms by customer for admin list so each customer appears exactly once
    const customerMap = new Map();
    for (const chat of chats) {
      const custKey = chat.customer?._id?.toString() || chat.customer?.toString() || chat._id.toString();
      if (!customerMap.has(custKey)) {
        customerMap.set(custKey, chat);
      }
    }
    const deduplicatedChats = Array.from(customerMap.values());

    const result = formatPaginatedResponse(deduplicatedChats, deduplicatedChats.length, page, limit);
    return successResponse(res, 200, "Chats retrieved successfully", result.items, result.pagination);
  } catch (error) {
    next(error);
  }
};

/**
 * Get single chat by ID
 * GET /api/chats/:id
 */
export const getChatById = async (req, res, next) => {
  try {
    const chat = await Chat.findById(req.params.id)
      .populate("customer", CUSTOMER_POPULATE)
      .populate("order", "orderNumber status totalAmount items");

    if (!chat) {
      return errorResponse(res, 404, "Chat not found");
    }

    if (req.user.role === "customer" && chat.customer._id.toString() !== req.user._id.toString()) {
      return errorResponse(res, 403, "Access denied");
    }

    return successResponse(res, 200, "Chat details retrieved", chat);
  } catch (error) {
    next(error);
  }
};

/**
 * Mark chat as read
 * PATCH /api/chats/:id/read
 */
export const markChatRead = async (req, res, next) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat) {
      return errorResponse(res, 404, "Chat not found");
    }

    if (req.user.role === "customer") {
      await Chat.updateMany({ customer: chat.customer }, { unreadForCustomer: 0 });
      chat.unreadForCustomer = 0;
      await Message.updateMany(
        { chat: chat._id, senderRole: { $ne: "customer" }, read: false },
        { read: true }
      );
    } else {
      await Chat.updateMany({ customer: chat.customer }, { unreadForAdmin: 0 });
      chat.unreadForAdmin = 0;
      await Message.updateMany(
        { chat: chat._id, senderRole: "customer", read: false },
        { read: true }
      );
    }

    await chat.save();
    return successResponse(res, 200, "Chat marked as read", chat);
  } catch (error) {
    next(error);
  }
};

/**
 * Update chat status
 * PATCH /api/chats/:id/status
 */
export const updateChatStatus = async (req, res, next) => {
  try {
    if (req.user.role === "customer") {
      return errorResponse(res, 403, "Only admins can update chat status");
    }

    const chat = await Chat.findById(req.params.id).populate("customer", CUSTOMER_POPULATE);
    if (!chat) {
      return errorResponse(res, 404, "Chat not found");
    }

    const status = normalizeChatStatus(req.body.status);
    if (!["open", "awaiting_invoice", "awaiting_payment", "closed"].includes(status)) {
      return errorResponse(res, 400, "Invalid chat status");
    }

    chat.status = status;
    await chat.save();

    return successResponse(res, 200, "Chat status updated", chat);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a chat session and its messages
 * DELETE /api/chats/:id
 */
export const deleteChat = async (req, res, next) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (!chat) {
      // Delete any rooms for customer ID if provided as fallback
      await Chat.deleteMany({ customer: req.params.id });
      return successResponse(res, 200, "Chat session deleted");
    }

    if (req.user.role === "customer" && chat.customer.toString() !== req.user._id.toString()) {
      return errorResponse(res, 403, "Access denied");
    }

    const customerId = chat.customer;
    await Promise.all([
      Chat.deleteMany({ customer: customerId }),
      Message.deleteMany({ chat: chat._id }),
    ]);

    return successResponse(res, 200, "Chat session deleted successfully", { roomId: req.params.id });
  } catch (error) {
    next(error);
  }
};

export default {
  createOrGetChat,
  getChats,
  getChatById,
  markChatRead,
  updateChatStatus,
  deleteChat,
};
