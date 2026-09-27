import express from "express";
import invoiceController from "../controllers/invoiceController.js";
import { protect } from "../middleware/authMiddleware.js";
import { adminOrSubAdmin } from "../middleware/adminMiddleware.js";
import { validate } from "../middleware/validationMiddleware.js";
import {
  validateCreateInvoice,
  validateUpdateInvoiceStatus,
} from "../validators/invoiceValidator.js";
import { idempotency } from "../middleware/idempotencyMiddleware.js";
import { invoiceWriteLimiter } from "../middleware/rateLimiters.js";

const router = express.Router();

router.get("/", protect, invoiceController.getInvoices);
router.get("/:id", protect, invoiceController.getInvoiceById);
router.get("/:id/download", protect, invoiceController.getInvoiceDownloadData);

// Admin-only custom invoice routes
router.post(
  "/",
  protect,
  adminOrSubAdmin,
  invoiceWriteLimiter,
  idempotency,
  validate(validateCreateInvoice),
  invoiceController.createCustomInvoice
);

router.patch(
  "/:id",
  protect,
  adminOrSubAdmin,
  invoiceWriteLimiter,
  idempotency,
  validate(validateUpdateInvoiceStatus),
  invoiceController.updateInvoice
);

router.delete("/:id", protect, adminOrSubAdmin, invoiceWriteLimiter, idempotency, invoiceController.deleteInvoice);

export default router;
