import express from "express";
import authController from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validationMiddleware.js";
import { validateRegister, validateLogin } from "../validators/authValidator.js";
import { idempotency } from "../middleware/idempotencyMiddleware.js";
import { authLimiter, registrationLimiter } from "../middleware/rateLimiters.js";

const router = express.Router();

router.post("/register", registrationLimiter, idempotency, validate(validateRegister), authController.register);
router.post("/login", authLimiter, validate(validateLogin), authController.login);
router.post("/logout", authController.logout);
router.get("/me", protect, authController.getMe);

export default router;
