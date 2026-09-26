import Announcement from "../models/Announcement.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";

/**
 * POST /api/admin/announcements
 * Create a new announcement (Admin only)
 */
export const createAnnouncement = async (req, res, next) => {
  try {
    const {
      title,
      message,
      type,
      target,
      targetUser,
      actionUrl,
      actionText,
      imageUrl,
      priority,
      expiresAt,
    } = req.body;

    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Title and message are required.",
      });
    }

    if (target === "specific_customer" && !targetUser) {
      return res.status(400).json({
        success: false,
        message: "Please select a specific customer for this targeted announcement.",
      });
    }

    const announcement = await Announcement.create({
      title: title.trim(),
      message: message.trim(),
      type: type || "general",
      target: target || "all",
      targetUser: target === "specific_customer" ? targetUser : null,
      actionUrl: actionUrl?.trim() || "",
      actionText: actionText?.trim() || "",
      imageUrl: imageUrl?.trim() || "",
      priority: priority || "normal",
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdBy: req.user._id,
    });

    // Generate System Notifications so it appears in notification bells
    try {
      if (target === "specific_customer" && targetUser) {
        await Notification.create({
          recipient: targetUser,
          type: "PROFILE_UPDATED", // general update fallback
          title: title.trim(),
          message: message.trim(),
        });
      } else {
        // Broadcast to all active users
        const users = await User.find({ accountStatus: "active" }).select("_id").lean();
        if (users.length > 0) {
          const notificationsToInsert = users.map((u) => ({
            recipient: u._id,
            type: "PROFILE_UPDATED",
            title: title.trim(),
            message: message.trim(),
          }));
          await Notification.insertMany(notificationsToInsert, { ordered: false }).catch(() => {});
        }
      }
    } catch (notifErr) {
      console.warn("[createAnnouncement] Notification insertion warning:", notifErr.message);
    }

    const populated = await Announcement.findById(announcement._id)
      .populate("createdBy", "firstName lastName email")
      .populate("targetUser", "firstName lastName email phone")
      .lean();

    return res.status(201).json({
      success: true,
      message: "Announcement published successfully",
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/announcements
 * Get all announcements for admin view
 */
export const getAdminAnnouncements = async (req, res, next) => {
  try {
    const announcements = await Announcement.find()
      .populate("createdBy", "firstName lastName email")
      .populate("targetUser", "firstName lastName email phone")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: announcements,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/announcements/:id/status
 * Change announcement status (active/dismissed/expired)
 */
export const updateAnnouncementStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["active", "dismissed", "expired"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status value. Must be 'active', 'dismissed', or 'expired'.",
      });
    }

    const announcement = await Announcement.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    )
      .populate("createdBy", "firstName lastName email")
      .populate("targetUser", "firstName lastName email phone")
      .lean();

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Announcement status set to '${status}'`,
      data: announcement,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/announcements/:id
 * Delete an announcement
 */
export const deleteAnnouncement = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await Announcement.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Announcement deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/announcements/active
 * Get active announcements for current logged-in customer
 */
export const getActiveAnnouncements = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const now = new Date();

    const query = {
      status: "active",
      $or: [{ target: "all" }, { targetUser: userId }],
      $and: [
        { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
      ],
    };

    const list = await Announcement.find(query)
      .sort({ createdAt: -1 })
      .lean();

    // Map items, attaching `isDismissedByMe` flag
    const formatted = list.map((item) => {
      const isDismissedByMe = (item.dismissedBy || []).some(
        (id) => id.toString() === userId.toString()
      );
      return {
        ...item,
        isDismissedByMe,
      };
    });

    return res.status(200).json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/announcements/:id/dismiss
 * Dismiss modal popup for current user
 */
export const dismissAnnouncementForUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    await Announcement.findByIdAndUpdate(id, {
      $addToSet: { dismissedBy: userId },
    });

    return res.status(200).json({
      success: true,
      message: "Announcement dismissed for user.",
    });
  } catch (error) {
    next(error);
  }
};

export default {
  createAnnouncement,
  getAdminAnnouncements,
  updateAnnouncementStatus,
  deleteAnnouncement,
  getActiveAnnouncements,
  dismissAnnouncementForUser,
};
