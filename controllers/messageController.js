import Message from "../models/Message.js";
import Chat from "../models/Chat.js";
import mongoose from "mongoose";
import {
  uploadBuffer,
  parseCloudinaryUrl,
  downloadAssetBuffer,
} from "../services/cloudinaryService.js";
import { notifyAdmins, notifyUser } from "../services/notificationService.js";
import { getPagination, formatPaginatedResponse } from "../utils/pagination.js";
import { successResponse, errorResponse } from "../utils/response.js";

const SENDER_POPULATE = "firstName lastName email role phone profile";

const parseBodyAttachments = (rawAttachments) => {
  if (!rawAttachments) return [];

  let parsed = rawAttachments;
  if (typeof rawAttachments === "string") {
    try {
      parsed = JSON.parse(rawAttachments);
    } catch {
      parsed = [rawAttachments];
    }
  }

  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list
    .map((attachment) => {
      if (!attachment) return null;
      if (typeof attachment === "string") {
        return { url: attachment, type: "image" };
      }
      const url = attachment.url || attachment.secure_url || attachment.image || attachment.src;
      if (!url) return null;
      const isPdf =
        String(attachment.type || "").toLowerCase().includes("pdf") ||
        String(url).toLowerCase().includes(".pdf") ||
        String(attachment.name || "").toLowerCase().endsWith(".pdf");
      return {
        url,
        type: isPdf ? "pdf" : attachment.type || "image",
        publicId: attachment.publicId || "",
        name: attachment.name || attachment.filename || "",
      };
    })
    .filter(Boolean);
};

/**
 * Get messages for a chat with pagination
 * GET /api/chats/:id/messages
 */
export const getChatMessages = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req, 200);

    const chat = await Chat.findById(req.params.id);
    if (!chat) {
      return errorResponse(res, 404, "Chat not found");
    }

    if (req.user.role === "customer" && chat.customer.toString() !== req.user._id.toString()) {
      return errorResponse(res, 403, "Access denied");
    }

    const [messages, totalCount] = await Promise.all([
      Message.find({ chat: chat._id })
        .populate("sender", SENDER_POPULATE)
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit),
      Message.countDocuments({ chat: chat._id }),
    ]);

    const result = formatPaginatedResponse(messages, totalCount, page, limit);
    return successResponse(res, 200, "Messages retrieved", result.items, result.pagination);
  } catch (error) {
    next(error);
  }
};

/**
 * Send a message in a chat
 * POST /api/chats/:id/messages
 */
export const sendMessage = async (req, res, next) => {
  try {
    const content = (req.body.content || req.body.text || req.body.message || "").toString();
    const chat = await Chat.findById(req.params.id);
    if (!chat) {
      return errorResponse(res, 404, "Chat not found");
    }

    if (req.user.role === "customer" && chat.customer.toString() !== req.user._id.toString()) {
      return errorResponse(res, 403, "Access denied");
    }

    const attachments = parseBodyAttachments(req.body.attachments);

    if (req.body.image) {
      attachments.push({ url: req.body.image, type: "image" });
    }

    const uploadedFiles = req.files?.length ? req.files : req.file ? [req.file] : [];
    for (const file of uploadedFiles) {
      const isPdf =
        file.mimetype === "application/pdf" ||
        String(file.originalname || "").toLowerCase().endsWith(".pdf");
      const uploadResult = await uploadBuffer(file.buffer, "vinoff_chat_attachments", {
        mimetype: file.mimetype,
        filename: file.originalname,
      });
      attachments.push({
        url: uploadResult.url,
        type: isPdf ? "pdf" : file.mimetype.startsWith("image/") ? "image" : "document",
        publicId: uploadResult.publicId,
        name: file.originalname || "",
      });
    }

    const trimmedContent = content.trim();
    if (!trimmedContent && attachments.length === 0) {
      return errorResponse(res, 400, "Message must contain either text content or an attachment");
    }

    const senderRole = req.user.role === "subAdmin" ? "subAdmin" : req.user.role;
    const rawInvoiceRef = req.body.invoiceRef || req.body.invoiceId;
    const invoiceRef = mongoose.isValidObjectId(rawInvoiceRef) ? rawInvoiceRef : undefined;
    const message = await Message.create({
      chat: chat._id,
      sender: req.user._id,
      senderRole,
      content: trimmedContent,
      attachments,
      ...(invoiceRef ? { invoiceRef } : {}),
    });

    chat.lastMessage = trimmedContent || "Sent an attachment";
    chat.lastMessageAt = new Date();
    if (!chat.assignedAdmin && senderRole !== "customer") {
      chat.assignedAdmin = req.user._id;
    }

    if (senderRole === "customer") {
      chat.unreadForAdmin += 1;
      await notifyAdmins({
        type: "NEW_MESSAGE",
        title: "New Customer Message",
        message: `${req.user.firstName}: ${chat.lastMessage.slice(0, 80)}`,
        relatedUser: req.user._id,
        relatedChat: chat._id,
      });
    } else {
      chat.unreadForCustomer += 1;
      await notifyUser({
        recipientId: chat.customer,
        type: "NEW_MESSAGE",
        title: "Admin Reply",
        message: `Admin: ${chat.lastMessage.slice(0, 80)}`,
        relatedChat: chat._id,
      });
    }

    await chat.save();

    const populatedMessage = await Message.findById(message._id).populate("sender", SENDER_POPULATE);

    return successResponse(res, 201, "Message sent successfully", populatedMessage);
  } catch (error) {
    next(error);
  }
};

const safeFilename = (name, fallback = "document.pdf") => {
  const cleaned = String(name || "")
    .replace(/[/\\?%*:|"<>]/g, "")
    .trim();
  return cleaned || fallback;
};

/**
 * Stream a chat attachment through the API so Cloudinary 401s never hit the browser.
 * GET /api/chats/:id/attachments/download
 */
export const downloadChatAttachment = async (req, res, next) => {
  try {
    const rawUrl = String(req.query.url || req.query.attachmentUrl || "").trim();
    if (!rawUrl) {
      return errorResponse(res, 400, "Attachment URL is required");
    }

    const chat = await Chat.findById(req.params.id);
    if (!chat) {
      return errorResponse(res, 404, "Chat not found");
    }

    if (req.user.role === "customer" && chat.customer.toString() !== req.user._id.toString()) {
      return errorResponse(res, 403, "Access denied");
    }

    const parsed = parseCloudinaryUrl(rawUrl);
    const messages = await Message.find({
      chat: chat._id,
      "attachments.0": { $exists: true },
    }).select("attachments");

    const attachment = messages
      .flatMap((message) => message.attachments || [])
      .find((item) => {
        if (!item?.url) return false;
        if (item.url === rawUrl) return true;
        if (parsed?.publicId && (item.publicId === parsed.publicId || item.url.includes(parsed.publicId))) {
          return true;
        }
        return false;
      });

    if (!attachment) {
      return errorResponse(res, 404, "Attachment not found in this chat");
    }

    const buffer = await downloadAssetBuffer(attachment.url);
    const filename = safeFilename(attachment.name || req.query.filename, "Invoice_Document.pdf");
    const isPdf = filename.toLowerCase().endsWith(".pdf") || attachment.type === "pdf";

    res.setHeader("Content-Type", isPdf ? "application/pdf" : "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    return res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
};

export default {
  getChatMessages,
  sendMessage,
  downloadChatAttachment,
};
