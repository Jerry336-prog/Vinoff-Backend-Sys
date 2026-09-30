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

// ==========================================
// 4. SESSIONS & DEVICE HISTORY
// ==========================================
router.get("/sessions", protect, getSessions);
router.post("/sessions/revoke-others", protect, revokeOtherSessions);
router.delete("/sessions/:sessionId", protect, revokeSessionById);

export default router;
