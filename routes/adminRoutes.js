import express from "express";
import adminController from "../controllers/adminController.js";
import productController from "../controllers/productController.js";
import orderController from "../controllers/orderController.js";
import invoiceController from "../controllers/invoiceController.js";
import chatController from "../controllers/chatController.js";
import notificationController from "../controllers/notificationController.js";
import expenseController from "../controllers/expenseController.js";
import announcementController from "../controllers/announcementController.js";
import { protect } from "../middleware/authMiddleware.js";
import { adminOrSubAdmin } from "../middleware/adminMiddleware.js";

const router = express.Router();

// Apply auth and admin checks across all admin routes
router.use(protect, adminOrSubAdmin);

// Dashboard
router.get("/dashboard", adminController.getDashboardStats);

// Users & Customers management
router.get("/users", adminController.getUsers);
router.patch("/users/:id/role", adminController.updateUserRole);
router.get("/customers", adminController.getCustomers);
router.get("/customers/:id", adminController.getCustomerById);
router.patch("/customers/:id/status", adminController.updateCustomerStatus);

// Product management routes for admin
router.get("/products", productController.getProducts);

// Order management routes for admin
router.get("/orders", orderController.getOrders);
router.patch("/orders/:id/status", orderController.updateOrderStatus);

// Invoice management routes for admin
router.get("/invoices", invoiceController.getInvoices);

// Chat & Communications for admin
router.get("/chats", chatController.getChats);
router.get("/notifications", notificationController.getNotifications);

// System Activity Logs
router.get("/activity", adminController.getActivityLogs);

// Expense Tracker
router.get("/expenses", expenseController.getLedgers);
router.get("/expenses/history", expenseController.getLedgers);
router.get("/expenses/today", expenseController.getTodayLedger);
router.post("/expenses/setup", expenseController.setupFirstDay);
router.post("/expenses/item", expenseController.addEntry);
router.post("/expenses/today/entry", expenseController.addEntry);
router.delete("/expenses/item/:entryId", expenseController.removeEntry);
router.delete("/expenses/today/entry/:entryId", expenseController.removeEntry);
router.post("/expenses/close", expenseController.closeDay);
router.patch("/expenses/today/close", expenseController.closeDay);

// Announcements Management
router.post("/announcements", announcementController.createAnnouncement);
router.get("/announcements", announcementController.getAdminAnnouncements);
router.patch("/announcements/:id/status", announcementController.updateAnnouncementStatus);
router.delete("/announcements/:id", announcementController.deleteAnnouncement);

export default router;

