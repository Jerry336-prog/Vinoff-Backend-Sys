import express from "express";
import {
  getBankDetails,
  updateBankDetails,
  getStoreStatus,
  updateStoreStatus,
  getNotificationSettings,
  updateNotificationSettings,
  getSessions,
  revokeOtherSessions,
  revokeSessionById,
  getStoreLocation,
  updateStoreLocation,
  getCategories,
  addCategory,
  removeCategory,
  testEmailNotification,
} from "../controllers/settingController.js";
import { protect } from "../middleware/authMiddleware.js";
import { adminOrSubAdmin, superAdminOnly } from "../middleware/adminMiddleware.js";
import { idempotency } from "../middleware/idempotencyMiddleware.js";

const router = express.Router();

// ==========================================
// 1. BANK ACCOUNT SETTINGS
// ==========================================
router.get("/bank-details", getBankDetails);
router.put(
  "/bank-details",
  protect,
  superAdminOnly,
  idempotency,
  updateBankDetails
);

// ==========================================
// 2. STORE STATUS & VACATION MODE
// ==========================================
router.get("/store-status", getStoreStatus);
router.put(
  "/store-status",
  protect,
  adminOrSubAdmin,
  idempotency,
  updateStoreStatus
);

// ==========================================
// 3. AUTOMATED ALERTS & NOTIFICATIONS
// ==========================================
router.get("/notifications", protect, adminOrSubAdmin, getNotificationSettings);
router.put(
  "/notifications",
  protect,
  adminOrSubAdmin,
  idempotency,
  updateNotificationSettings
);
router.post(
  "/test-email",
  protect,
  adminOrSubAdmin,
  testEmailNotification
);

// ==========================================
// 4. SESSIONS & DEVICE HISTORY
// ==========================================
router.get("/sessions", protect, getSessions);
router.post("/sessions/revoke-others", protect, revokeOtherSessions);
router.delete("/sessions/:sessionId", protect, revokeSessionById);

// ==========================================
// 5. STORE LOCATION & WORKING STORE
// ==========================================
router.get("/store-location", getStoreLocation);
router.put(
  "/store-location",
  protect,
  adminOrSubAdmin,
  idempotency,
  updateStoreLocation
);

// ==========================================
// 6. STORE / PRODUCT CATEGORIES
// ==========================================
router.get("/categories", getCategories);
router.post(
  "/categories",
  protect,
  adminOrSubAdmin,
  idempotency,
  addCategory
);
router.delete(
  "/categories/:name",
  protect,
  adminOrSubAdmin,
  idempotency,
  removeCategory
);

export default router;
