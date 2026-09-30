import crypto from "crypto";
import Setting from "../models/Setting.js";
import User from "../models/User.js";
import { successResponse, errorResponse } from "../utils/response.js";
import { logActivity } from "../services/notificationService.js";
import { generateToken } from "../services/authService.js";
import { parseClientInfo } from "../utils/deviceParser.js";

// ==========================================
// 1. BANK ACCOUNT SETTINGS
// ==========================================
const DEFAULT_BANK_DETAILS = {
  bankName: "Guaranty Trust Bank (GTB)",
  accountName: "Vinoff Wholesales Ltd",
  accountNumber: "0123456789",
  instructions: "Please use your Order # or Invoice # as the transfer payment narration.",
};

export const getBankDetails = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ key: "bank_details" });
    const bankDetails = setting ? setting.value : DEFAULT_BANK_DETAILS;
    return successResponse(res, 200, "Bank account details retrieved successfully", bankDetails);
  } catch (error) {
    next(error);
  }
};

export const updateBankDetails = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== "superadmin") {
      return errorResponse(
        res,
        403,
        "Access denied. Only Super Admin accounts can modify company bank details."
      );
    }

    const { bankName, accountName, accountNumber, instructions } = req.body;

    if (!bankName || !bankName.trim()) {
      return errorResponse(res, 400, "Bank Name is required");
    }
    if (!accountName || !accountName.trim()) {
      return errorResponse(res, 400, "Account Name is required");
    }
    if (!accountNumber || !accountNumber.trim()) {
      return errorResponse(res, 400, "Account Number is required");
    }

    const updatedDetails = {
      bankName: bankName.trim(),
      accountName: accountName.trim(),
      accountNumber: accountNumber.trim(),
      instructions: instructions ? instructions.trim() : "",
    };

    const setting = await Setting.findOneAndUpdate(
      { key: "bank_details" },
      {
        key: "bank_details",
        value: updatedDetails,
        updatedBy: req.user._id,
      },
      { upsert: true, new: true, runValidators: true }
    );

    await logActivity({
      actorId: req.user._id,
      action: "Super Admin updated company bank account details",
      targetType: "Setting",
      targetId: setting._id,
      description: `Super Admin updated bank details: ${updatedDetails.bankName} (${updatedDetails.accountNumber})`,
      metadata: updatedDetails,
    });

    return successResponse(
      res,
      200,
      "Company bank account details updated successfully",
      setting.value
    );
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 2. STORE STATUS & VACATION MODE SETTINGS
// ==========================================
const DEFAULT_STORE_STATUS = {
  isOpen: true,
  bannerMessage: "We are restocking our warehouse for the weekend. Orders placed today will be dispatched Monday.",
  noticeType: "warning",
  allowBrowsing: true,
};

export const getStoreStatus = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ key: "store_status" });
    const storeStatus = setting ? { ...DEFAULT_STORE_STATUS, ...setting.value } : DEFAULT_STORE_STATUS;
    return successResponse(res, 200, "Store operational status retrieved successfully", storeStatus);
  } catch (error) {
    next(error);
  }
};

export const updateStoreStatus = async (req, res, next) => {
  try {
    const { isOpen, bannerMessage, noticeType, allowBrowsing } = req.body;

    const updatedStatus = {
      isOpen: isOpen !== undefined ? Boolean(isOpen) : true,
      bannerMessage: typeof bannerMessage === "string" ? bannerMessage.trim() : "",
      noticeType: ["info", "warning", "alert"].includes(noticeType) ? noticeType : "warning",
      allowBrowsing: allowBrowsing !== undefined ? Boolean(allowBrowsing) : true,
      updatedAt: new Date(),
    };

    const setting = await Setting.findOneAndUpdate(
      { key: "store_status" },
      {
        key: "store_status",
        value: updatedStatus,
        updatedBy: req.user._id,
      },
      { upsert: true, new: true, runValidators: true }
    );

    await logActivity({
      actorId: req.user._id,
      action: `Store status toggled to: ${updatedStatus.isOpen ? "OPEN FOR ORDERS" : "TEMPORARILY CLOSED / VACATION"}`,
      targetType: "Setting",
      targetId: setting._id,
      description: `Admin changed store status to ${updatedStatus.isOpen ? "Open" : "Temporarily Closed"}. Notice: "${updatedStatus.bannerMessage || 'None'}"`,
      metadata: updatedStatus,
    });

    return successResponse(
      res,
      200,
      `Store is now ${updatedStatus.isOpen ? "Open for Orders" : "Temporarily Closed / Vacation Mode"}`,
      setting.value
    );
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 3. AUTOMATED ALERTS & NOTIFICATION PREFERENCES
// ==========================================
const DEFAULT_NOTIFICATIONS = {
  lowStockThreshold: 5,
  categoryThresholds: {
    Beverages: 10,
    Toiletries: 5,
    Cosmetics: 5,
    "Food & Groceries": 10,
    Confectioneries: 10,
    Household: 5,
  },
  lowStockAlertsEnabled: true,
  whatsappNotificationsEnabled: true,
  whatsappNumber: "",
  notifyOnNewOrder: true,
  notifyOnNewCustomer: true,
  soundAlertsEnabled: true,
};

export const getNotificationSettings = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ key: "notification_preferences" });
    const notificationPrefs = setting ? { ...DEFAULT_NOTIFICATIONS, ...setting.value } : DEFAULT_NOTIFICATIONS;
    return successResponse(res, 200, "Notification preferences retrieved successfully", notificationPrefs);
  } catch (error) {
    next(error);
  }
};

export const updateNotificationSettings = async (req, res, next) => {
  try {
    const {
      lowStockThreshold,
      categoryThresholds,
      lowStockAlertsEnabled,
      whatsappNotificationsEnabled,
      whatsappNumber,
      notifyOnNewOrder,
      notifyOnNewCustomer,
      soundAlertsEnabled,
    } = req.body;

    const updated = {
      lowStockThreshold: Number(lowStockThreshold) >= 0 ? Number(lowStockThreshold) : 5,
      categoryThresholds:
        typeof categoryThresholds === "object" && categoryThresholds !== null
          ? categoryThresholds
          : DEFAULT_NOTIFICATIONS.categoryThresholds,
      lowStockAlertsEnabled: lowStockAlertsEnabled !== undefined ? Boolean(lowStockAlertsEnabled) : true,
      whatsappNotificationsEnabled: whatsappNotificationsEnabled !== undefined ? Boolean(whatsappNotificationsEnabled) : false,
      whatsappNumber: typeof whatsappNumber === "string" ? whatsappNumber.trim() : "",
      notifyOnNewOrder: notifyOnNewOrder !== undefined ? Boolean(notifyOnNewOrder) : true,
      notifyOnNewCustomer: notifyOnNewCustomer !== undefined ? Boolean(notifyOnNewCustomer) : true,
      soundAlertsEnabled: soundAlertsEnabled !== undefined ? Boolean(soundAlertsEnabled) : true,
      updatedAt: new Date(),
    };

    const setting = await Setting.findOneAndUpdate(
      { key: "notification_preferences" },
      {
        key: "notification_preferences",
        value: updated,
        updatedBy: req.user._id,
      },
      { upsert: true, new: true, runValidators: true }
    );

    await logActivity({
      actorId: req.user._id,
      action: "Admin updated alert and notification preferences",
      targetType: "Setting",
      targetId: setting._id,
      description: `Notification preferences updated: Low stock alert threshold (${updated.lowStockThreshold} cartons), WhatsApp alerts: ${
        updated.whatsappNotificationsEnabled ? `ON (${updated.whatsappNumber || 'No phone set'})` : "OFF"
      }`,
      metadata: updated,
    });

    return successResponse(res, 200, "Alert and notification preferences updated successfully", setting.value);
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 4. SESSION MANAGER & DEVICE HISTORY
// ==========================================
export const getSessions = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("sessions");
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    let sessions = Array.isArray(user.sessions) ? [...user.sessions] : [];

    // If user has no sessions yet, create one for the current device
    if (sessions.length === 0) {
      const clientInfo = parseClientInfo(req);
      const newSessionId = req.sessionId || crypto.randomUUID();
      const current = {
        sessionId: newSessionId,
        device: clientInfo.device,
        browser: clientInfo.browser,
        os: clientInfo.os,
        ip: clientInfo.ip,
        userAgent: clientInfo.userAgent,
        lastActive: new Date(),
        createdAt: new Date(),
      };
      sessions.push(current);
      user.sessions = sessions;
      await user.save({ validateBeforeSave: false });
    }

    // Sort by last active descending
    sessions.sort((a, b) => new Date(b.lastActive || 0) - new Date(a.lastActive || 0));

    const formattedSessions = sessions.map((s) => ({
      sessionId: s.sessionId,
      device: s.device,
      browser: s.browser,
      os: s.os,
      ip: s.ip,
      userAgent: s.userAgent,
      lastActive: s.lastActive,
      createdAt: s.createdAt,
      isCurrent: Boolean(req.sessionId && s.sessionId === req.sessionId) || sessions[0]?.sessionId === s.sessionId,
    }));

    return successResponse(res, 200, "Active sessions retrieved successfully", formattedSessions);
  } catch (error) {
    next(error);
  }
};

export const revokeOtherSessions = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    let currentSessionId = req.sessionId;
    let currentSession = user.sessions?.find((s) => s.sessionId === currentSessionId);

    if (!currentSession) {
      const clientInfo = parseClientInfo(req);
      currentSessionId = crypto.randomUUID();
      currentSession = {
        sessionId: currentSessionId,
        device: clientInfo.device,
        browser: clientInfo.browser,
        os: clientInfo.os,
        ip: clientInfo.ip,
        userAgent: clientInfo.userAgent,
        lastActive: new Date(),
        createdAt: new Date(),
      };
    } else {
      currentSession.lastActive = new Date();
    }

    // Invalidate prior tokens by setting cutoff time
    const cutoffTime = new Date();
    user.tokensValidAfter = cutoffTime;
    user.sessions = [currentSession];

    await user.save({ validateBeforeSave: false });

    // Issue fresh token for current session
    const freshToken = generateToken(user, currentSessionId);

    const isProd = process.env.NODE_ENV === "production";
    res.cookie("token", freshToken, {
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
    });

    await logActivity({
      actorId: user._id,
      action: "Revoked all other active sessions",
      targetType: "User",
      targetId: user._id,
      description: `${user.firstName} ${user.lastName} (${user.role}) logged out of all other devices`,
      metadata: { currentSessionId },
    });

    return successResponse(res, 200, "Successfully logged out of all other devices", {
      token: freshToken,
      sessions: [
        {
          ...(currentSession.toObject ? currentSession.toObject() : currentSession),
          isCurrent: true,
        },
      ],
    });
  } catch (error) {
    next(error);
  }
};

export const revokeSessionById = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const user = await User.findById(req.user._id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    if (sessionId === req.sessionId) {
      return errorResponse(res, 400, "Cannot revoke the current session. Please log out instead.");
    }

    user.sessions = user.sessions.filter((s) => s.sessionId !== sessionId);
    await user.save({ validateBeforeSave: false });

    return successResponse(res, 200, "Session revoked successfully");
  } catch (error) {
    next(error);
  }
};
