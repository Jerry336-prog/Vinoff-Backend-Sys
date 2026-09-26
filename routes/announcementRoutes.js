import express from "express";
import {
  getActiveAnnouncements,
  dismissAnnouncementForUser,
} from "../controllers/announcementController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/active", getActiveAnnouncements);
router.post("/:id/dismiss", dismissAnnouncementForUser);

export default router;
