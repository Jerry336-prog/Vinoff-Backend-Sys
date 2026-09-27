import express from "express";
import messageController from "../controllers/messageController.js";
import { protect } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js";
import { idempotency } from "../middleware/idempotencyMiddleware.js";
import { chatMessageLimiter } from "../middleware/rateLimiters.js";

const router = express.Router({ mergeParams: true });

// Standalone message router if mounted at /api/messages or /api/chats/:id/messages
router.get("/:id", protect, messageController.getChatMessages);
router.get("/:id/messages", protect, messageController.getChatMessages);
router.post(
  "/:id",
  protect,
  chatMessageLimiter,
  idempotency,
  upload.array("attachments", 5),
  messageController.sendMessage
);
router.post(
  "/:id/messages",
  protect,
  chatMessageLimiter,
  idempotency,
  upload.array("attachments", 5),
  messageController.sendMessage
);

export default router;
