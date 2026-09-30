import express from "express";
import notificationController from "../controllers/notificationController.js";
import { protect } from "../middleware/authMiddleware.js";
import { idempotency } from "../middleware/idempotencyMiddleware.js";

const router = express.Router();

router.use(protect, idempotency);

router.get("/", notificationController.getNotifications);
router.patch("/read-all", notificationController.markAllNotificationsAsRead);
router.patch("/:id/read", notificationController.markNotificationAsRead);

export default router;
