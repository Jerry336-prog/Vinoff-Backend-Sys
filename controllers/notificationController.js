import Notification from "../models/Notification.js";
import { getPagination, formatPaginatedResponse } from "../utils/pagination.js";
import { successResponse, errorResponse } from "../utils/response.js";

/**
 * Get notifications for authenticated user
 * GET /api/notifications
 */
export const getNotifications = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req, 20);

    const [notifications, totalCount, unreadCount] = await Promise.all([
      Notification.find({ recipient: req.user._id })
        .populate("relatedUser", "firstName lastName email")
        .populate("relatedOrder", "orderNumber status totalAmount")
        .populate("relatedInvoice", "invoiceNumber status total")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments({ recipient: req.user._id }),
      Notification.countDocuments({ recipient: req.user._id, read: false }),
    ]);

    const result = formatPaginatedResponse(notifications, totalCount, page, limit);
    return successResponse(res, 200, "Notifications retrieved successfully", {
      ...result,
      unreadCount,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark a single notification as read
 * PATCH /api/notifications/:id/read
 */
export const markNotificationAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.user._id,
    });

    if (!notification) {
      return errorResponse(res, 404, "Notification not found");
    }

    notification.read = true;
    await notification.save();

    return successResponse(res, 200, "Notification marked as read", notification);
  } catch (error) {
    next(error);
  }
};

/**
 * Mark all notifications as read for current user
 * PATCH /api/notifications/read-all
 */
export const markAllNotificationsAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, read: false },
      { read: true }
    );

    return successResponse(res, 200, "All notifications marked as read");
  } catch (error) {
    next(error);
  }
};

export default {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};
