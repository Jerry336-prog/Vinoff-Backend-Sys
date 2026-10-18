import User from "../models/User.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import Invoice from "../models/Invoice.js";
import Chat from "../models/Chat.js";
import Notification from "../models/Notification.js";
import ActivityLog from "../models/ActivityLog.js";
import { recalculateCustomerCredit } from "../services/invoiceService.js";
import { notifyUser } from "../services/notificationService.js";
import { getPagination, formatPaginatedResponse } from "../utils/pagination.js";
import { successResponse, errorResponse } from "../utils/response.js";

/**
 * Helper to enrich user documents with live unpaid credit invoice totals
 */
const enrichUsersWithLiveCredit = async (users) => {
  if (!Array.isArray(users) || users.length === 0) return users;

  const creditAgg = await Invoice.aggregate([
    {
      $match: {
        $or: [
          { status: "On Credit" },
          { isCredit: true, status: { $nin: ["Paid", "Cancelled"] } },
        ],
      },
    },
    {
      $group: {
        _id: "$customer",
        totalCredit: { $sum: "$total" },
      },
    },
  ]);

  const creditMap = new Map(
    creditAgg.map((item) => [String(item._id), Number(item.totalCredit || 0)])
  );

  return users.map((u) => {
    const obj = u.toJSON ? u.toJSON() : { ...u };
    const uid = String(obj._id || obj.id);
    const liveCredit = creditMap.get(uid) ?? 0;

    if (Number(obj.outstandingCredit || 0) !== liveCredit) {
      User.updateOne({ _id: obj._id }, { outstandingCredit: liveCredit }).catch(() => {});
    }

    obj.outstandingCredit = liveCredit;
    obj.isOwingCredit = liveCredit > 0;
    return obj;
  });
};

/**
 * Get aggregated admin dashboard metrics
 * GET /api/admin/dashboard
 */
export const getDashboardStats = async (req, res, next) => {
  try {
    const [
      totalCustomers,
      customersWithUpdatedProfile,
      vipCreditPartnersCount,
      totalProducts,
      lowStockProducts,
      totalOrders,
      pendingOrders,
      awaitingConfirmations,
      completedOrders,
      revenueResult,
      standalonePaidInvoicesResult,
      totalInvoices,
      pendingInvoicesResult,
      creditInvoicesResult,
      unreadAdminChats,
      unreadNotifications,
      recentActivity,
    ] = await Promise.all([
      // Customers
      User.countDocuments({ role: "customer" }),
      User.countDocuments({ role: "customer", profileUpdatedAt: { $ne: null } }),
      User.countDocuments({ role: "customer", isVipCreditPartner: true }),

      // Products
      Product.countDocuments(),
      Product.countDocuments({ stock: { $lte: 5 } }),

      // Orders
      Order.countDocuments(),
      Order.countDocuments({ status: "Pending Payment" }),
      Order.countDocuments({ status: "Awaiting Confirmation" }),
      Order.countDocuments({ status: "Completed" }),

      // Revenue: Sum totalAmount of orders with confirmed payments (excludes unpaid credit orders)
      Order.aggregate([
        { $match: { paymentStatus: "Confirmed" } },
        { $group: { _id: null, totalRevenue: { $sum: "$total" } } },
      ]).then(async () =>
        Order.aggregate([
          { $match: { paymentStatus: "Confirmed" } },
          { $group: { _id: null, totalRevenue: { $sum: "$totalAmount" } } },
        ])
      ),

      // Standalone custom invoices marked Paid (not linked to an order)
      Invoice.aggregate([
        { $match: { status: "Paid", $or: [{ order: null }, { order: { $exists: false } }] } },
        { $group: { _id: null, totalPaid: { $sum: "$total" } } },
      ]),

      // Invoices
      Invoice.countDocuments(),
      Invoice.aggregate([
        { $match: { status: "Pending" } },
        { $group: { _id: null, count: { $sum: 1 }, totalPending: { $sum: "$total" } } },
      ]),
      Invoice.aggregate([
        {
          $match: {
            $or: [
              { status: "On Credit" },
              { isCredit: true, status: { $nin: ["Paid", "Cancelled"] } },
            ],
          },
        },
        { $group: { _id: null, count: { $sum: 1 }, totalCreditOwing: { $sum: "$total" } } },
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

    const confirmedOrderRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;
    const standalonePaidRevenue =
      standalonePaidInvoicesResult.length > 0 ? standalonePaidInvoicesResult[0].totalPaid : 0;
    const totalRevenue = confirmedOrderRevenue + standalonePaidRevenue;

    const pendingInvoicesCount = pendingInvoicesResult.length > 0 ? pendingInvoicesResult[0].count : 0;
    const pendingInvoicesTotal = pendingInvoicesResult.length > 0 ? pendingInvoicesResult[0].totalPending : 0;
    const creditInvoicesCount = creditInvoicesResult.length > 0 ? creditInvoicesResult[0].count : 0;
    const totalOutstandingCredit = creditInvoicesResult.length > 0 ? creditInvoicesResult[0].totalCreditOwing : 0;
    const unreadMessagesCount = unreadAdminChats.length > 0 ? unreadAdminChats[0].totalUnread : 0;

    return successResponse(res, 200, "Dashboard metrics retrieved successfully", {
      customers: {
        total: totalCustomers,
        withProfileUpdates: customersWithUpdatedProfile,
        vipCreditPartners: vipCreditPartnersCount,
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
        creditCount: creditInvoicesCount,
        totalOutstandingCredit,
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
    const { search, status, profileUpdated, vipCredit } = req.query;

    const query = { role: "customer" };

    if (status) {
      query.accountStatus = status;
    }

    if (profileUpdated === "true") {
      query.profileUpdatedAt = { $ne: null };
    }

    if (vipCredit === "true") {
      query.isVipCreditPartner = true;
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

    const enrichedCustomers = await enrichUsersWithLiveCredit(customers);
    const result = formatPaginatedResponse(enrichedCustomers, totalCount, page, limit);
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

    const liveCredit = await recalculateCustomerCredit(customer._id);
    const customerObj = customer.toJSON ? customer.toJSON() : { ...customer };
    customerObj.outstandingCredit = liveCredit;
    customerObj.isOwingCredit = liveCredit > 0;

    return successResponse(res, 200, "Customer details retrieved", customerObj);
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
 * Toggle or update customer VIP Credit Partner privilege
 * PATCH /api/admin/customers/:id/vip-credit
 */
export const updateCustomerVipCredit = async (req, res, next) => {
  try {
    const { isVipCreditPartner } = req.body;
    const customer = await User.findById(req.params.id);
    if (!customer) {
      return errorResponse(res, 404, "Customer not found");
    }

    const nextVipState =
      typeof isVipCreditPartner === "boolean"
        ? isVipCreditPartner
        : !customer.isVipCreditPartner;

    customer.isVipCreditPartner = nextVipState;
    await customer.save();

    const liveCredit = await recalculateCustomerCredit(customer._id);
    const customerObj = customer.toJSON ? customer.toJSON() : { ...customer };
    customerObj.outstandingCredit = liveCredit;
    customerObj.isOwingCredit = liveCredit > 0;

    await ActivityLog.create({
      actor: req.user._id,
      action: nextVipState
        ? "Admin upgraded customer to VIP Credit Partner"
        : "Admin revoked VIP Credit Partner status",
      targetType: "User",
      targetId: customer._id,
      description: `Admin ${req.user.firstName} ${req.user.lastName} ${
        nextVipState ? "granted" : "revoked"
      } VIP Credit Partner status for ${customer.firstName} ${customer.lastName} (${customer.email})`,
      metadata: { isVipCreditPartner: nextVipState, outstandingCredit: liveCredit },
    });

    await notifyUser({
      recipientId: customer._id,
      type: "VIP_CREDIT_UPDATED",
      title: nextVipState ? "VIP Credit Partner Unlocked" : "VIP Credit Partner Status Updated",
      message: nextVipState
        ? "Congratulations! Your wholesale account has been upgraded to a VIP Credit Partner. You can now place orders on credit and track your credit invoices directly from your header."
        : "Your VIP Credit Partner privilege has been updated by an administrator.",
      relatedUser: customer._id,
    }).catch(() => {});

    return successResponse(
      res,
      200,
      nextVipState
        ? `${customer.firstName} ${customer.lastName} is now a VIP Credit Partner`
        : `VIP Credit Partner status revoked for ${customer.firstName} ${customer.lastName}`,
      customerObj
    );
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

    const enrichedUsers = await enrichUsersWithLiveCredit(users);
    const result = formatPaginatedResponse(enrichedUsers, totalCount, page, limit);
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
  updateCustomerVipCredit,
  getActivityLogs,
  getUsers,
  updateUserRole,
};
