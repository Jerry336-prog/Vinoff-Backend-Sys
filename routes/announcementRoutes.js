import express from "express";
import {
  getActiveAnnouncements,
  dismissAnnouncementForUser,
} from "../controllers/announcementController.js";
import { protect } from "../middleware/authMiddleware.js";
import { idempotency } from "../middleware/idempotencyMiddleware.js";

const router = express.Router();

router.use(protect, idempotency);

router.get("/active", getActiveAnnouncements);
router.post("/:id/dismiss", dismissAnnouncementForUser);

export default router;
