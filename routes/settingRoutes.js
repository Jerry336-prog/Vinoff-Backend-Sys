import express from "express";
import { getBankDetails, updateBankDetails } from "../controllers/settingController.js";
import { protect } from "../middleware/authMiddleware.js";
import { superAdminOnly } from "../middleware/adminMiddleware.js";
import { idempotency } from "../middleware/idempotencyMiddleware.js";

const router = express.Router();

// GET /api/settings/bank-details - Accessible to customers, guests, and admins
router.get("/bank-details", getBankDetails);

// PUT /api/settings/bank-details - Protected, admin authentication required (superadmin validated inside controller)
router.put("/bank-details", protect, superAdminOnly, idempotency, updateBankDetails);

export default router;
