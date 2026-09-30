import crypto from "crypto";
import Setting from "../models/Setting.js";
import User from "../models/User.js";
import Product from "../models/Product.js";
import { successResponse, errorResponse } from "../utils/response.js";
import { logActivity } from "../services/notificationService.js";
import { generateToken } from "../services/authService.js";
import { parseClientInfo } from "../utils/deviceParser.js";
import { sendOrderAlertEmail } from "../services/emailService.js";

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

export const STANDARD_CATEGORIES = [
  "Toiletries",
  "Household Cleaners",
  "Cosmetics",
  "Laundry Care",
];

const DEFAULT_NOTIFICATIONS = {
  lowStockThreshold: 5,
  categoryThresholds: {
    Toiletries: 5,
    "Household Cleaners": 5,
    Cosmetics: 5,
    "Laundry Care": 5,
  },
  lowStockAlertsEnabled: true,
  notifyOnNewOrder: true,
  notifyOnNewCustomer: true,
  soundAlertsEnabled: true,
};

export const getNotificationSettings = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ key: "notification_preferences" });
    const notificationPrefs = setting
      ? { ...DEFAULT_NOTIFICATIONS, ...setting.value }
      : { ...DEFAULT_NOTIFICATIONS };

    // Retrieve custom categories stored by admin
    const customCatSetting = await Setting.findOne({ key: "custom_categories" });
    const customCategories = Array.isArray(customCatSetting?.value) ? customCatSetting.value : [];

    const cleanCustom = customCategories.filter(
      (c) =>
        c &&
        typeof c === "string" &&
        !STANDARD_CATEGORIES.some((s) => s.toLowerCase() === c.trim().toLowerCase()) &&
        !/beverage/i.test(c)
    );

    const categoryList = Array.from(
      new Set([...STANDARD_CATEGORIES, ...cleanCustom])
    );

    const validCategoryThresholds = {};
    categoryList.forEach((cat) => {
      validCategoryThresholds[cat] =
        notificationPrefs.categoryThresholds?.[cat] ?? notificationPrefs.lowStockThreshold ?? 5;
    });

    notificationPrefs.categoryThresholds = validCategoryThresholds;
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
      notifyOnNewOrder,
      notifyOnNewCustomer,
      soundAlertsEnabled,
    } = req.body;

    const customCatSetting = await Setting.findOne({ key: "custom_categories" });
    const customCategories = Array.isArray(customCatSetting?.value) ? customCatSetting.value : [];
    const allowedCategories = new Set([
      ...STANDARD_CATEGORIES.map((c) => c.toLowerCase()),
      ...customCategories.map((c) => c.toLowerCase()),
    ]);

    const sanitizedCategoryThresholds = {};
    if (typeof categoryThresholds === "object" && categoryThresholds !== null) {
      Object.entries(categoryThresholds).forEach(([k, v]) => {
        if (allowedCategories.has(k.toLowerCase()) && !/beverage/i.test(k)) {
          sanitizedCategoryThresholds[k] = Number(v) >= 0 ? Number(v) : 5;
        }
      });
    }

    const updated = {
      lowStockThreshold: Number(lowStockThreshold) >= 0 ? Number(lowStockThreshold) : 5,
      categoryThresholds:
        Object.keys(sanitizedCategoryThresholds).length > 0
          ? sanitizedCategoryThresholds
          : DEFAULT_NOTIFICATIONS.categoryThresholds,
      lowStockAlertsEnabled: lowStockAlertsEnabled !== undefined ? Boolean(lowStockAlertsEnabled) : true,
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
      description: `Notification preferences updated: Low stock alert threshold (${updated.lowStockThreshold} cartons), Email alerts: active`,
      metadata: updated,
    });

    return successResponse(res, 200, "Alert and notification preferences updated successfully", setting.value);
  } catch (error) {
    next(error);
  }
};

export const testEmailNotification = async (req, res, next) => {
  try {
    const ownerEmail = (process.env.EMAIL_USER || req.user?.email || "chinedujeremiah723@gmail.com").trim();
    const emailPromise = sendOrderAlertEmail({
      orderNumber: `TEST-${Math.floor(1000 + Math.random() * 9000)}`,
      customerName: `${req.user?.firstName || "Store"} ${req.user?.lastName || "Admin"}`.trim(),
      phone: req.user?.phone || "+234 803 000 0000",
      totalAmount: 185000,
      itemsCount: 2,
      targetEmail: ownerEmail,
      items: [
        { name: "Toiletries Box (Sample)", quantity: 2, unitType: "cartons", price: 45000 },
        { name: "Multipurpose Detergent 10L (Sample)", quantity: 1, unitType: "cartons", price: 95000 },
      ],
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Email dispatch timed out after 8s")), 8000)
    );

    const result = await Promise.race([emailPromise, timeoutPromise]);

    if (result && result.success) {
      return successResponse(
        res,
        200,
        `Test email alert successfully sent to ${result.recipients?.join(", ") || ownerEmail}! (${result.provider || "Delivered"})`,
        result
      );
    } else {
      return errorResponse(res, 500, `Email failed to send: ${result?.error || result?.reason || "Check server logs"}`);
    }
  } catch (error) {
    return errorResponse(res, 500, `Email test failed: ${error.message}`);
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

// ==========================================
// 5. STORE LOCATION & WORKING STORE
// ==========================================
const DEFAULT_STORE_LOCATION = {
  shopAddress: "KADUNA PLAZA 1, BLOCK A, SHOP 22",
  complexArea: "INT’L CENTRE FOR COMMERCE, TRADE-FAIR COMPLEX",
  cityState: "BADAGRY EXPRESS WAY, LAGOS, NIGERIA",
  operatingHours: "Monday – Saturday: 8:00 AM – 5:30 PM",
  phoneContact: "+234 803 000 0000",
  walkthroughVideoUrl: "/VINOFF_C0_walkthrough.MP4",
};

export const getStoreLocation = async (req, res, next) => {
  try {
    const setting = await Setting.findOne({ key: "store_location" });
    const storeLocation = setting ? { ...DEFAULT_STORE_LOCATION, ...setting.value } : DEFAULT_STORE_LOCATION;
    return successResponse(res, 200, "Store location details retrieved successfully", storeLocation);
  } catch (error) {
    next(error);
  }
};

export const updateStoreLocation = async (req, res, next) => {
  try {
    const {
      shopAddress,
      complexArea,
      cityState,
      operatingHours,
      phoneContact,
      walkthroughVideoUrl,
    } = req.body;

    const updated = {
      shopAddress:
        typeof shopAddress === "string" && shopAddress.trim()
          ? shopAddress.trim()
          : DEFAULT_STORE_LOCATION.shopAddress,
      complexArea:
        typeof complexArea === "string" && complexArea.trim()
          ? complexArea.trim()
          : DEFAULT_STORE_LOCATION.complexArea,
      cityState:
        typeof cityState === "string" && cityState.trim()
          ? cityState.trim()
          : DEFAULT_STORE_LOCATION.cityState,
      operatingHours:
        typeof operatingHours === "string" && operatingHours.trim()
          ? operatingHours.trim()
          : DEFAULT_STORE_LOCATION.operatingHours,
      phoneContact:
        typeof phoneContact === "string" && phoneContact.trim()
          ? phoneContact.trim()
          : DEFAULT_STORE_LOCATION.phoneContact,
      walkthroughVideoUrl:
        typeof walkthroughVideoUrl === "string" && walkthroughVideoUrl.trim()
          ? walkthroughVideoUrl.trim()
          : DEFAULT_STORE_LOCATION.walkthroughVideoUrl,
      updatedAt: new Date(),
    };

    const setting = await Setting.findOneAndUpdate(
      { key: "store_location" },
      {
        key: "store_location",
        value: updated,
        updatedBy: req.user._id,
      },
      { upsert: true, new: true, runValidators: true }
    );

    await logActivity({
      actorId: req.user._id,
      action: "Admin updated store location details",
      targetType: "Setting",
      targetId: setting._id,
      description: `Store location updated: ${updated.shopAddress}, ${updated.complexArea}, ${updated.cityState}`,
      metadata: updated,
    });

    return successResponse(res, 200, "Store location details updated successfully", setting.value);
  } catch (error) {
    next(error);
  }
};

// ==========================================
// 6. PRODUCT / STORE CATEGORIES
// ==========================================
export const getCategories = async (req, res, next) => {
  try {
    const customCatSetting = await Setting.findOne({ key: "custom_categories" });
    const customCategories = Array.isArray(customCatSetting?.value) ? customCatSetting.value : [];

    const cleanCustom = customCategories.filter(
      (c) =>
        c &&
        typeof c === "string" &&
        !STANDARD_CATEGORIES.some((s) => s.toLowerCase() === c.trim().toLowerCase()) &&
        !/beverage/i.test(c)
    );

    const allCategories = Array.from(
      new Set([...STANDARD_CATEGORIES, ...cleanCustom])
    );

    return successResponse(res, 200, "Categories retrieved successfully", {
      standardCategories: STANDARD_CATEGORIES,
      customCategories: cleanCustom,
      categories: allCategories,
    });
  } catch (error) {
    next(error);
  }
};

export const addCategory = async (req, res, next) => {
  try {
    const rawName = req.body.name || req.body.category;
    if (!rawName || typeof rawName !== "string" || !rawName.trim()) {
      return errorResponse(res, 400, "Category name is required");
    }

    const name = rawName.trim();
    if (name.length < 2) {
      return errorResponse(res, 400, "Category name must be at least 2 characters");
    }

    if (/beverage/i.test(name)) {
      return errorResponse(res, 400, "Beverage categories are not allowed in this catalog");
    }

    const customCatSetting = await Setting.findOne({ key: "custom_categories" });
    const customCategories = Array.isArray(customCatSetting?.value) ? [...customCatSetting.value] : [];

    const existsInStandard = STANDARD_CATEGORIES.some((c) => c.toLowerCase() === name.toLowerCase());
    const existsInCustom = customCategories.some((c) => c.toLowerCase() === name.toLowerCase());

    if (!existsInStandard && !existsInCustom) {
      customCategories.push(name);
      await Setting.findOneAndUpdate(
        { key: "custom_categories" },
        {
          key: "custom_categories",
          value: customCategories,
          updatedBy: req.user?._id || null,
        },
        { upsert: true, new: true }
      );

      // Also ensure this new category is in notification_preferences.categoryThresholds
      const notifSetting = await Setting.findOne({ key: "notification_preferences" });
      if (notifSetting && typeof notifSetting.value === "object") {
        const catThresholds = { ...(notifSetting.value.categoryThresholds || {}) };
        if (catThresholds[name] === undefined) {
          catThresholds[name] = notifSetting.value.lowStockThreshold || 5;
          notifSetting.value.categoryThresholds = catThresholds;
          notifSetting.markModified("value");
          await notifSetting.save();
        }
      }

      if (req.user?._id) {
        await logActivity({
          actorId: req.user._id,
          action: "Admin added custom product category",
          targetType: "Setting",
          targetId: null,
          description: `Created new category: "${name}"`,
          metadata: { category: name },
        });
      }
    }

    const cleanCustom = customCategories.filter(
      (c) =>
        c &&
        typeof c === "string" &&
        !STANDARD_CATEGORIES.some((s) => s.toLowerCase() === c.trim().toLowerCase()) &&
        !/beverage/i.test(c)
    );

    const allCategories = Array.from(
      new Set([...STANDARD_CATEGORIES, ...cleanCustom])
    );

    return successResponse(res, 201, `Category "${name}" added successfully`, {
      name,
      standardCategories: STANDARD_CATEGORIES,
      customCategories: cleanCustom,
      categories: allCategories,
    });
  } catch (error) {
    next(error);
  }
};

export const removeCategory = async (req, res, next) => {
  try {
    const name = decodeURIComponent(req.params.name || "").trim();
    if (!name) {
      return errorResponse(res, 400, "Category name is required");
    }

    const isStandard = STANDARD_CATEGORIES.some((c) => c.toLowerCase() === name.toLowerCase());
    if (isStandard) {
      return errorResponse(res, 400, `Standard category "${name}" cannot be deleted.`);
    }

    const customCatSetting = await Setting.findOne({ key: "custom_categories" });
    const customCategories = Array.isArray(customCatSetting?.value) ? customCatSetting.value : [];

    const filtered = customCategories.filter((c) => c && c.toLowerCase() !== name.toLowerCase());

    await Setting.findOneAndUpdate(
      { key: "custom_categories" },
      {
        key: "custom_categories",
        value: filtered,
        updatedBy: req.user?._id || null,
      },
      { upsert: true, new: true }
    );

    // Reassign any products assigned to this deleted custom category back to "Toiletries"
    await Product.updateMany(
      { category: { $regex: new RegExp(`^${name}$`, "i") } },
      { $set: { category: "Toiletries" } }
    );

    // Remove from notification thresholds reliably using markModified
    const notifSetting = await Setting.findOne({ key: "notification_preferences" });
    if (notifSetting && typeof notifSetting.value === "object") {
      const thresholds = { ...(notifSetting.value.categoryThresholds || {}) };
      Object.keys(thresholds).forEach((key) => {
        if (key.toLowerCase() === name.toLowerCase()) {
          delete thresholds[key];
        }
      });
      notifSetting.value.categoryThresholds = thresholds;
      notifSetting.markModified("value");
      await notifSetting.save();
    }

    if (req.user?._id) {
      await logActivity({
        actorId: req.user._id,
        action: "Admin removed custom product category",
        targetType: "Setting",
        targetId: null,
        description: `Removed custom category: "${name}"`,
        metadata: { category: name },
      });
    }

    const allCategories = Array.from(new Set([...STANDARD_CATEGORIES, ...filtered]));

    return successResponse(res, 200, `Category "${name}" removed successfully`, {
      standardCategories: STANDARD_CATEGORIES,
      customCategories: filtered,
      categories: allCategories,
    });
  } catch (error) {
    next(error);
  }
};
