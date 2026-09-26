import express from "express";
import orderController from "../controllers/orderController.js";
import { protect } from "../middleware/authMiddleware.js";
import { adminOrSubAdmin } from "../middleware/adminMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js";
import { validate } from "../middleware/validationMiddleware.js";
import { validateCreateOrder } from "../validators/orderValidator.js";

const router = express.Router();

router.post("/", protect, validate(validateCreateOrder), orderController.createOrder);
router.get("/", protect, orderController.getOrders);
router.get("/:id", protect, orderController.getOrderById);
router.post(
  "/:id/payment",
  protect,
  upload.single("screenshot"),
  orderController.uploadPayment
);

// Order status updates (Admin)
router.patch("/:id/status", protect, adminOrSubAdmin, orderController.updateOrderStatus);
router.post("/:id/confirm-payment", protect, adminOrSubAdmin, orderController.confirmOrderPayment);

export default router;
