import express from "express";
import productController from "../controllers/productController.js";
import { protect } from "../middleware/authMiddleware.js";
import { adminOrSubAdmin } from "../middleware/adminMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js";
import { validate } from "../middleware/validationMiddleware.js";
import { validateProduct } from "../validators/productValidator.js";
import { idempotency } from "../middleware/idempotencyMiddleware.js";
import { productWriteLimiter } from "../middleware/rateLimiters.js";

const router = express.Router();

// Public routes
router.get("/", productController.getProducts);
router.get("/:id", productController.getProductById);

// Admin-only routes
router.post(
  "/",
  protect,
  adminOrSubAdmin,
  productWriteLimiter,
  idempotency,
  upload.array("images", 5),
  validate((body) => validateProduct(body, false)),
  productController.createProduct
);

router.patch(
  "/:id",
  protect,
  adminOrSubAdmin,
  productWriteLimiter,
  idempotency,
  upload.array("images", 5),
  validate((body) => validateProduct(body, true)),
  productController.updateProduct
);

router.delete("/:id", protect, adminOrSubAdmin, productWriteLimiter, idempotency, productController.deleteProduct);

export default router;
