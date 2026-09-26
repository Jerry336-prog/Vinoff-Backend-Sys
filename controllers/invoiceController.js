import Invoice, { INVOICE_STATUSES } from "../models/Invoice.js";
import {
  createCustomInvoice as createCustomInvoiceService,
  updateInvoiceStatus as updateInvoiceStatusService,
} from "../services/invoiceService.js";
import { getPagination, formatPaginatedResponse } from "../utils/pagination.js";
import { successResponse, errorResponse } from "../utils/response.js";
import { logActivity } from "../services/notificationService.js";

/**
 * Get invoices (Scoped by role: customer sees theirs; admin sees all)
 * GET /api/invoices
 */
export const getInvoices = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req, 20);
    const { status, customerId, startDate, endDate } = req.query;

    const query = {};

    if (req.user.role === "customer") {
      query.customer = req.user._id;
    } else if (customerId) {
      query.customer = customerId;
    }

    if (status) {
      query.status = status;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const [invoices, totalCount] = await Promise.all([
      Invoice.find(query)
        .populate("customer", "firstName lastName email phone profile")
        .populate("order", "orderNumber status paymentStatus")
        .populate("createdBy", "firstName lastName email role profile")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Invoice.countDocuments(query),
    ]);

    const result = formatPaginatedResponse(invoices, totalCount, page, limit);
    return successResponse(res, 200, "Invoices retrieved successfully", result.items, result.pagination);
  } catch (error) {
    next(error);
  }
};

/**
 * Get invoice by ID
 * GET /api/invoices/:id
 */
export const getInvoiceById = async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate("customer", "firstName lastName email phone profile")
      .populate("order", "orderNumber status paymentStatus items")
      .populate("createdBy", "firstName lastName email role profile");

    if (!invoice) {
      return errorResponse(res, 404, "Invoice not found");
    }

    if (req.user.role === "customer" && invoice.customer._id.toString() !== req.user._id.toString()) {
      return errorResponse(res, 403, "Access denied. You can only view your own invoices.");
    }

    return successResponse(res, 200, "Invoice retrieved successfully", invoice);
  } catch (error) {
    next(error);
  }
};

/**
 * Create a custom invoice (Admin only)
 * POST /api/invoices
 */
export const createCustomInvoice = async (req, res, next) => {
  try {
    const { customer, items, discount, deliveryFee, dueDate, notes, status } = req.body;

    const invoice = await createCustomInvoiceService({
      customer,
      items,
      discount,
      deliveryFee,
      dueDate,
      notes,
      status: status || "Pending",
      createdBy: req.user._id,
    });

    return successResponse(res, 201, "Custom invoice created successfully", invoice);
  } catch (error) {
    next(error);
  }
};

/**
 * Update invoice status or details (Admin only)
 * PATCH /api/invoices/:id
 */
export const updateInvoice = async (req, res, next) => {
  try {
    const { status, notes, dueDate, issuedBy, items, discount, deliveryFee } = req.body;

    if (status && !INVOICE_STATUSES.includes(status)) {
      return errorResponse(
        res,
        400,
        `Invalid status '${status}'. Allowed statuses are strictly: ${INVOICE_STATUSES.join(", ")}`
      );
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return errorResponse(res, 404, "Invoice not found");
    }

    if (status) {
      await updateInvoiceStatusService(invoice._id, status, req.user._id);
      invoice.status = status;
    }

    if (notes !== undefined) invoice.notes = notes;
    if (dueDate !== undefined) invoice.dueDate = new Date(dueDate);
    if (issuedBy !== undefined) invoice.issuedBy = issuedBy;
    if (items !== undefined) invoice.items = items;
    if (discount !== undefined) invoice.discount = discount;
    if (deliveryFee !== undefined) invoice.deliveryFee = deliveryFee;

    if (req.user && !invoice.createdBy) {
      invoice.createdBy = req.user._id;
    }

    await invoice.save();

    return successResponse(res, 200, "Invoice updated successfully", invoice);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete invoice (Admin only)
 * DELETE /api/invoices/:id
 */
export const deleteInvoice = async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return errorResponse(res, 404, "Invoice not found");
    }

    await Invoice.findByIdAndDelete(req.params.id);

    await logActivity({
      actorId: req.user._id,
      action: "Admin deleted invoice",
      targetType: "Invoice",
      targetId: invoice._id,
      description: `Admin deleted invoice #${invoice.invoiceNumber}`,
    });

    return successResponse(res, 200, "Invoice deleted successfully");
  } catch (error) {
    next(error);
  }
};

/**
 * Get formatted invoice data for PDF/print/download
 * GET /api/invoices/:id/download
 */
export const getInvoiceDownloadData = async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate("customer", "firstName lastName email phone profile")
      .populate("order", "orderNumber createdAt paymentStatus")
      .populate("createdBy", "firstName lastName email role profile");

    if (!invoice) {
      return errorResponse(res, 404, "Invoice not found");
    }

    if (req.user.role === "customer" && invoice.customer._id.toString() !== req.user._id.toString()) {
      return errorResponse(res, 403, "Access denied");
    }

    const downloadPayload = {
      platform: "Vinoff Wholesale E-Commerce",
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.createdAt,
      dueDate: invoice.dueDate,
      status: invoice.status,
      customer: {
        name: `${invoice.customer.firstName} ${invoice.customer.lastName}`,
        email: invoice.customer.email,
        phone: invoice.customer.phone,
        company: invoice.customer.profile?.companyName || "",
        address: invoice.customer.profile?.address || "",
        city: invoice.customer.profile?.city || "",
        state: invoice.customer.profile?.state || "",
      },
      issuedBy:
        invoice.issuedBy ||
        (invoice.createdBy
          ? `${invoice.createdBy.firstName || ""} ${invoice.createdBy.lastName || ""}`.trim() || invoice.createdBy.name
          : null),
      createdBy: invoice.createdBy
        ? {
            firstName: invoice.createdBy.firstName,
            lastName: invoice.createdBy.lastName,
            role: invoice.createdBy.role,
          }
        : null,
      items: invoice.items,
      subtotal: invoice.subtotal,
      discount: invoice.discount,
      deliveryFee: invoice.deliveryFee,
      total: invoice.total,
      notes: invoice.notes,
    };

    return successResponse(res, 200, "Invoice download data prepared", downloadPayload);
  } catch (error) {
    next(error);
  }
};

export default {
  getInvoices,
  getInvoiceById,
  createCustomInvoice,
  updateInvoice,
  deleteInvoice,
  getInvoiceDownloadData,
};
