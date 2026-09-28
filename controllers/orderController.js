import Order from "../models/Order.js";
import {
  createOrder as createOrderService,
  submitPaymentScreenshot,
  confirmPayment as confirmPaymentService,
  updateOrderStatus as updateOrderStatusService,
} from "../services/orderService.js";
import { getPagination, formatPaginatedResponse } from "../utils/pagination.js";
import { successResponse, errorResponse } from "../utils/response.js";

/**
 * Create a new wholesale order
 * POST /api/orders
 */
export const createOrder = async (req, res, next) => {
  try {
    const { items, deliveryFee, notes } = req.body;
    const result = await createOrderService({
      customerId: req.user._id,
      items,
      deliveryFee,
      notes,
    });
    return successResponse(res, 201, "Order placed successfully", result);
  } catch (error) {
    next(error);
  }
};

/**
 * Get orders (for customer: their orders; for admin: all orders)
 * GET /api/orders
 */
export const getOrders = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req, 20);
    const { status, paymentStatus, customerId } = req.query;

    const query = {};

    // Role-based scoping
    if (req.user.role === "customer") {
      query.customer = req.user._id;
    } else if (customerId) {
      query.customer = customerId;
    }

    if (status) {
      query.status = status;
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    const [orders, totalCount] = await Promise.all([
      Order.find(query)
        .populate("customer", "firstName lastName email phone profile")
        .populate("invoice", "invoiceNumber status total")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(query),
    ]);

    const result = formatPaginatedResponse(orders, totalCount, page, limit);
    return successResponse(res, 200, "Orders retrieved successfully", result.items, result.pagination);
  } catch (error) {
    next(error);
  }
};

/**
 * Get order by ID
 * GET /api/orders/:id
 */
export const getOrderById = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customer", "firstName lastName email phone profile")
      .populate("invoice");

    if (!order) {
      return errorResponse(res, 404, "Order not found!");
    }

    // Customer can only view their own orders
    if (req.user.role === "customer" && order.customer._id.toString() !== req.user._id.toString()) {
      return errorResponse(res, 403, "Access denied. You can only view your own orders.");
    }

    return successResponse(res, 200, "Order retrieved successfully", order);
  } catch (error) {
    next(error);
  }
};

/**
 * Upload payment screenshot for an order
 * POST /api/orders/:id/payment
 */
export const uploadPayment = async (req, res, next) => {
  try {
    if (!req.file) {
      return errorResponse(res, 400, "Payment screenshot image is required");
    }

    const order = await submitPaymentScreenshot({
      orderId: req.params.id,
      customerId: req.user._id,
      fileBuffer: req.file.buffer,
    });

    return successResponse(
      res,
      200,
      "Payment screenshot submitted successfully. Status updated to 'Awaiting Confirmation'",
      order
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Update order status (Admin or status change)
 * PATCH /api/orders/:id/status
 */
export const updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) {
      return errorResponse(res, 400, "Status is required");
    }

    // If changing to Payment Confirmed, invoke payment confirmation
    if (status === "Payment Confirmed") {
      const order = await confirmPaymentService(req.params.id, req.user._id);
      return successResponse(res, 200, "Payment confirmed successfully", order);
    }

    const order = await updateOrderStatusService(req.params.id, status, req.user._id);
    return successResponse(res, 200, `Order status updated to '${status}'`, order);
  } catch (error) {
    next(error);
  }
};

/**
 * Confirm payment directly (Admin only)
 * POST /api/orders/:id/confirm-payment
 */
export const confirmOrderPayment = async (req, res, next) => {
  try {
    const order = await confirmPaymentService(req.params.id, req.user._id);
    return successResponse(res, 200, "Payment confirmed and invoice marked as Paid", order);
  } catch (error) {
    next(error);
  }
};

export default {
  createOrder,
  getOrders,
  getOrderById,
  uploadPayment,
  updateOrderStatus,
  confirmOrderPayment,
};
