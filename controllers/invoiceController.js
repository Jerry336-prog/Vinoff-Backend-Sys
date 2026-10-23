import Invoice, { INVOICE_STATUSES } from "../models/Invoice.js";
import {
  createCustomInvoice as createCustomInvoiceService,
  updateInvoiceDetails,
  deleteInvoiceRecord,
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
    const { page, limit, skip } = getPagination(req, 50);
    const { status, customerId, customer, isCredit, startDate, endDate } = req.query;

    const query = {};
    const targetCustomer = customerId || customer;

    if (req.user.role === "customer") {
      query.customer = req.user._id;
    } else if (targetCustomer) {
      query.customer = targetCustomer;
    }

    if (status) {
      query.status = status;
    }

    if (isCredit === "true") {
      query.$or = [{ isCredit: true }, { status: "On Credit" }];
    } else if (isCredit === "false") {
      query.isCredit = { $ne: true };
      if (!status) {
        query.status = { $ne: "On Credit" };
      }
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const [invoices, totalCount] = await Promise.all([
      Invoice.find(query)
        .populate("customer", "firstName lastName email phone profile isVipCreditPartner outstandingCredit")
        .populate("order", "orderNumber status paymentStatus isCreditOrder paymentMethod")
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
 * Get invoice by ID (also resolves Order ID, invoiceNumber, or orderNumber)
 * GET /api/invoices/:id
 */
export const getInvoiceById = async (req, res, next) => {
  try {
    const rawId = String(req.params.id || "").trim();
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(rawId);

    const populateInvoice = (query) =>
      query
        .populate("customer", "firstName lastName email phone profile isVipCreditPartner outstandingCredit")
        .populate("order", "orderNumber status paymentStatus isCreditOrder paymentMethod items")
        .populate("createdBy", "firstName lastName email role profile");

    let invoice = null;

    if (isObjectId) {
      invoice = await populateInvoice(Invoice.findById(rawId));
      if (!invoice) {
        invoice = await populateInvoice(Invoice.findOne({ order: rawId }));
      }
    }

    if (!invoice) {
      invoice = await populateInvoice(Invoice.findOne({ invoiceNumber: rawId }));
    }

    // Fallback: check if rawId matches an Order (_id or orderNumber) and resolve/create its invoice
    if (!invoice) {
      const Order = (await import("../models/Order.js")).default;
      const order = isObjectId
        ? await Order.findById(rawId)
        : await Order.findOne({ orderNumber: rawId });

      if (order) {
        if (req.user.role === 'customer' && String(order.customer) !== String(req.user._id)) return errorResponse(res, 403, 'Access denied.');
        invoice = await populateInvoice(Invoice.findOne({ order: order._id }));
        if (!invoice) {
          const { createInvoiceForOrder } = await import("../services/invoiceService.js");
          const created = await createInvoiceForOrder(order);
          invoice = await populateInvoice(Invoice.findById(created._id));
        }
      }
    }

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
    const { customer, items, discount, deliveryFee, dueDate, notes, status, isCredit, issuedBy } = req.body;

    const invoice = await createCustomInvoiceService({
      customer,
      items,
      discount,
      deliveryFee,
      dueDate,
      notes,
      status: status || (isCredit ? "On Credit" : "Pending"),
      isCredit: Boolean(isCredit || status === "On Credit"),
      issuedBy: issuedBy || "",
      createdBy: req.user._id,
    });

    const populatedInvoice = await Invoice.findById(invoice._id)
      .populate("customer", "firstName lastName email phone profile isVipCreditPartner outstandingCredit")
      .populate("order", "orderNumber status paymentStatus isCreditOrder paymentMethod")
      .populate("createdBy", "firstName lastName email role profile");

    return successResponse(res, 201, "Custom invoice created successfully", populatedInvoice || invoice);
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
    const invoice = await updateInvoiceDetails(req.params.id, req.body, req.user._id);

    const updatedInvoice = await Invoice.findById(invoice._id)
      .populate("customer", "firstName lastName email phone profile isVipCreditPartner outstandingCredit")
      .populate("order", "orderNumber status paymentStatus isCreditOrder paymentMethod")
      .populate("createdBy", "firstName lastName email role profile");

    return successResponse(res, 200, "Invoice updated successfully", updatedInvoice || invoice);
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
    const invoice = await deleteInvoiceRecord(req.params.id);

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

    // Creating, editing or paying an invoice is not the same as stamping it.
    if (req.user.role === 'customer' && !String(invoice.issuedBy || '').trim()) {
      return errorResponse(
        res,
        403,
        'This invoice cannot be downloaded yet because it has not been stamped by an admin. Please contact the store to request a stamp, then try downloading again.',
        { code: 'INVOICE_NOT_STAMPED' },
      );
    }

    const downloadPayload = {
      _id: invoice._id,
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
      issuedBy: String(invoice.issuedBy || '').trim() || null,
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
