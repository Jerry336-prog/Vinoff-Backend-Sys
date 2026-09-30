import express from "express";
import chatController from "../controllers/chatController.js";
import messageController from "../controllers/messageController.js";
import { protect } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js";
import { idempotency } from "../middleware/idempotencyMiddleware.js";

const router = express.Router();

router.post("/", protect, idempotency, chatController.createOrGetChat);
router.get("/", protect, chatController.getChats);
router.get("/:id", protect, chatController.getChatById);
router.patch("/:id/read", protect, chatController.markChatRead);
router.patch("/:id/status", protect, idempotency, chatController.updateChatStatus);
router.delete("/:id", protect, idempotency, chatController.deleteChat);

// Messages nested under chats
router.get("/:id/messages", protect, messageController.getChatMessages);
router.get("/:id/attachments/download", protect, messageController.downloadChatAttachment);
router.post(
  "/:id/messages",
  protect,
  idempotency,
  upload.array("attachments", 5),
  messageController.sendMessage
);

export default router;
