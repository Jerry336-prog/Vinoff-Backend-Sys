import express from "express";
import userController from "../controllers/userController.js";
import { protect } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js";
import { validate } from "../middleware/validationMiddleware.js";
import { validateProfileUpdate } from "../validators/userValidator.js";
import { idempotency } from "../middleware/idempotencyMiddleware.js";
import { accountWriteLimiter } from "../middleware/rateLimiters.js";

const router = express.Router();

router.get("/me", protect, userController.getMyProfile);
router.patch(
  "/me",
  protect,
  accountWriteLimiter,
  idempotency,
  upload.single("avatar"),
  validate(validateProfileUpdate),
  userController.updateMyProfile
);

export default router;
