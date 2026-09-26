import express from "express";
import notificationController from "../controllers/notificationController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", protect, notificationController.getNotifications);
router.patch("/read-all", protect, notificationController.markAllNotificationsAsRead);
router.patch("/:id/read", protect, notificationController.markNotificationAsRead);

export default router;
