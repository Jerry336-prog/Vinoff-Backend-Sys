import Notification from "../models/Notification.js";
import ActivityLog from "../models/ActivityLog.js";
import User from "../models/User.js";

/**
 * Send notification to all admin and subAdmin users
 */
export const notifyAdmins = async ({
  type,
  title,
  message,
  relatedUser = null,
  relatedOrder = null,
  relatedInvoice = null,
  relatedChat = null,
}) => {
  try {
    const admins = await User.find({ role: { $in: ["admin", "subAdmin"] } }).select("_id");
    if (!admins.length) return [];

    const notifications = admins.map((admin) => ({
      recipient: admin._id,
      type,
      title,
      message,
      relatedUser,
      relatedOrder,
      relatedInvoice,
      relatedChat,
    }));

    return await Notification.insertMany(notifications);
  } catch (error) {
    console.error("[Notification Service] Error notifying admins:", error.message);
    return [];
  }
};

/**
 * Send notification to a specific user
 */
export const notifyUser = async ({
  recipientId,
  type,
  title,
  message,
  relatedUser = null,
  relatedOrder = null,
  relatedInvoice = null,
  relatedChat = null,
}) => {
  try {
    return await Notification.create({
      recipient: recipientId,
      type,
      title,
      message,
      relatedUser,
      relatedOrder,
      relatedInvoice,
      relatedChat,
    });
  } catch (error) {
    console.error("[Notification Service] Error notifying user:", error.message);
    return null;
  }
};

/**
 * Create an ActivityLog entry for audit trail
 */
export const logActivity = async ({
  actorId,
  action,
  targetType,
  targetId,
  description,
  metadata = {},
}) => {
  try {
    return await ActivityLog.create({
      actor: actorId,
      action,
      targetType,
      targetId,
      description,
      metadata,
    });
  } catch (error) {
    console.error("[ActivityLog Service] Error creating activity log:", error.message);
    return null;
  }
};

export default {
  notifyAdmins,
  notifyUser,
  logActivity,
};
