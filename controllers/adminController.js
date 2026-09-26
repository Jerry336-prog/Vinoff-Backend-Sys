import User from "../models/User.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import Invoice from "../models/Invoice.js";
import Chat from "../models/Chat.js";
import Notification from "../models/Notification.js";
import ActivityLog from "../models/ActivityLog.js";
import { getPagination, formatPaginatedResponse } from "../utils/pagination.js";
import { successResponse, errorResponse } from "../utils/response.js";

/**
 * Get aggregated admin dashboard metrics
 * GET /api/admin/dashboard
 */
export const getDashboardStats = async (req, res, next) => {
  try {
    const [
      totalCustomers,
      customersWithUpdatedProfile,
      totalProducts,
      lowStockProducts,
      totalOrders,
      pendingOrders,
      awaitingConfirmations,
      completedOrders,
      revenueResult,
      totalInvoices,
      pendingInvoicesResult,
      unreadAdminChats,
      unreadNotifications,
      recentActivity,
    ] = await Promise.all([
      // Customers
      User.countDocuments({ role: "customer" }),
      User.countDocuments({ role: "customer", profileUpdatedAt: { $ne: null } }),

      // Products
      Product.countDocuments(),
      Product.countDocuments({ stock: { $lte: 5 } }),

      // Orders
      Order.countDocuments(),
      Order.countDocuments({ status: "Pending Payment" }),
      Order.countDocuments({ status: "Awaiting Confirmation" }),
      Order.countDocuments({ status: "Completed" }),

      // Revenue: Sum totalAmount of orders with confirmed payments
      Order.aggregate([
        { $match: { paymentStatus: "Confirmed" } },
        { $group: { _id: null, totalRevenue: { $sum: "$totalAmount" } } },
      ]),

      // Invoices
      Invoice.countDocuments(),
      Invoice.aggregate([
        { $match: { status: "Pending" } },
        { $group: { _id: null, count: { $sum: 1 }, totalPending: { $sum: "$total" } } },
      ]),

      // Unread chats for admin
      Chat.aggregate([
        { $group: { _id: null, totalUnread: { $sum: "$unreadForAdmin" } } },
      ]),

      // Unread notifications for this admin
      Notification.countDocuments({ recipient: req.user._id, read: false }),

      // Recent activity
      ActivityLog.find()
        .populate("actor", "firstName lastName email role")
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;
    const pendingInvoicesCount = pendingInvoicesResult.length > 0 ? pendingInvoicesResult[0].count : 0;
    const pendingInvoicesTotal = pendingInvoicesResult.length > 0 ? pendingInvoicesResult[0].totalPending : 0;
    const unreadMessagesCount = unreadAdminChats.length > 0 ? unreadAdminChats[0].totalUnread : 0;

    return successResponse(res, 200, "Dashboard metrics retrieved successfully", {
      customers: {
        total: totalCustomers,
        withProfileUpdates: customersWithUpdatedProfile,
      },
      products: {
        total: totalProducts,
        lowStock: lowStockProducts,
      },
      orders: {
        total: totalOrders,
        pendingPayment: pendingOrders,
        awaitingConfirmation: awaitingConfirmations,
        completed: completedOrders,
        totalRevenue,
      },
      invoices: {
        total: totalInvoices,
        pendingCount: pendingInvoicesCount,
        pendingTotal: pendingInvoicesTotal,
      },
      communications: {
        unreadMessages: unreadMessagesCount,
        unreadNotifications,
      },
      recentActivity,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get customers list with search, status filter, and profile update indicators
 * GET /api/admin/customers
 */
export const getCustomers = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req, 100);
    const { search, status, profileUpdated } = req.query;

    const query = { role: "customer" };

    if (status) {
      query.accountStatus = status;
    }

    if (profileUpdated === "true") {
      query.profileUpdatedAt = { $ne: null };
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { phone: regex },
        { "profile.companyName": regex },
      ];
    }

    const [customers, totalCount] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(query),
    ]);

    const result = formatPaginatedResponse(customers, totalCount, page, limit);
    return successResponse(res, 200, "Customers retrieved successfully", result.items, result.pagination);
  } catch (error) {
    next(error);
  }
};

/**
 * Get customer by ID with associated orders, invoices and activity
 * GET /api/admin/customers/:id
 */
export const getCustomerById = async (req, res, next) => {
  try {
    const customer = await User.findById(req.params.id);
    if (!customer) {
      return errorResponse(res, 404, "User not found");
    }

    return successResponse(res, 200, "Customer details retrieved", customer);
  } catch (error) {
    next(error);
  }
};

/**
 * Update customer account status (active/suspended)
 * PATCH /api/admin/customers/:id/status
 */
export const updateCustomerStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!["active", "suspended"].includes(status)) {
      return errorResponse(res, 400, "Status must be either 'active' or 'suspended'");
    }

    const customer = await User.findOne({ _id: req.params.id, role: "customer" });
    if (!customer) {
      return errorResponse(res, 404, "Customer not found");
    }

    customer.accountStatus = status;
    await customer.save();

    await ActivityLog.create({
      actor: req.user._id,
      action: "Admin updated customer status",
      targetType: "User",
      targetId: customer._id,
      description: `Admin changed customer ${customer.email} status to '${status}'`,
      metadata: { newStatus: status },
    });

    return successResponse(res, 200, `Customer status updated to '${status}'`, customer);
  } catch (error) {
    next(error);
  }
};

/**
 * Get system activity logs
 * GET /api/admin/activity
 */
export const getActivityLogs = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req, 30);
    const { targetType, action, actor } = req.query;

    const query = {};
    if (targetType) query.targetType = targetType;
    if (action) query.action = action;
    if (actor) query.actor = actor;

    const [logs, totalCount] = await Promise.all([
      ActivityLog.find(query)
        .populate("actor", "firstName lastName email role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ActivityLog.countDocuments(query),
    ]);

    const result = formatPaginatedResponse(logs, totalCount, page, limit);
    return successResponse(res, 200, "Activity logs retrieved successfully", result.items, result.pagination);
  } catch (error) {
    next(error);
  }
};

/**
 * Get all users list with search & role filter (for Superadmin / Admin user management)
 * GET /api/admin/users
 */
export const getUsers = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req, 100);
    const { search, role, status } = req.query;

    const query = {};
    if (role) query.role = role;
    if (status) query.accountStatus = status;

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { phone: regex },
        { "profile.companyName": regex },
      ];
    }

    const [users, totalCount] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(query),
    ]);

    const result = formatPaginatedResponse(users, totalCount, page, limit);
    return successResponse(res, 200, "Users retrieved successfully", result.items, result.pagination);
  } catch (error) {
    next(error);
  }
};

/**
 * Update user role (Superadmin only: promote customer to admin, or demote admin to customer)
 * PATCH /api/admin/users/:id/role
 */
export const updateUserRole = async (req, res, next) => {
  try {
    if (req.user.role !== "superadmin") {
      return errorResponse(res, 403, "Only Superadmin can promote or demote user roles.");
    }

    const { role } = req.body;
    if (!["customer", "admin", "subAdmin", "superadmin"].includes(role)) {
      return errorResponse(res, 400, "Invalid role specified.");
    }

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return errorResponse(res, 404, "User not found");
    }

    const prevRole = targetUser.role;
    targetUser.role = role;
    await targetUser.save();

    await ActivityLog.create({
      actor: req.user._id,
      action: "Superadmin updated user role",
      targetType: "User",
      targetId: targetUser._id,
      description: `Superadmin ${req.user.firstName} ${req.user.lastName} changed ${targetUser.email} role from '${prevRole}' to '${role}'`,
      metadata: { prevRole, newRole: role },
    });

    return successResponse(res, 200, `User role successfully changed from '${prevRole}' to '${role}'`, targetUser);
  } catch (error) {
    next(error);
  }
};

export default {
  getDashboardStats,
  getCustomers,
  getCustomerById,
  updateCustomerStatus,
  getActivityLogs,
  getUsers,
  updateUserRole,
};
