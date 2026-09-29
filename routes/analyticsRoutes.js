import express from "express";
import { trackVisit, getAnalyticsSummary } from "../controllers/analyticsController.js";
import { protect } from "../middleware/authMiddleware.js";
import { adminOrSubAdmin } from "../middleware/adminMiddleware.js";

const router = express.Router();

// Public: Track page view / visitor entry
router.post("/track", trackVisit);

// Admin-only: Fetch traffic analytics metrics
router.get("/summary", protect, adminOrSubAdmin, getAnalyticsSummary);

export default router;
