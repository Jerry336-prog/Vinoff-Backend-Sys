import { INVOICE_STATUSES } from "../models/Invoice.js";

export const validateCreateInvoice = (body) => {
  const errors = {};
  if (!body.customer) {
    errors.customer = "Customer ID is required";
  }
  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    errors.items = "Invoice must contain at least one item";
  } else {
    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i];
      if (!item.description || !item.description.trim()) {
        errors[`items[${i}].description`] = "Item description is required";
      }
      if (!item.quantity || isNaN(Number(item.quantity)) || Number(item.quantity) < 1) {
        errors[`items[${i}].quantity`] = "Quantity must be at least 1";
      }
      if (item.unitPrice === undefined || isNaN(Number(item.unitPrice)) || Number(item.unitPrice) < 0) {
        errors[`items[${i}].unitPrice`] = "Valid unit price is required";
      }
    }
  }
  if (body.status && !INVOICE_STATUSES.includes(body.status)) {
    errors.status = `Invalid invoice status. Must be one of: ${INVOICE_STATUSES.join(", ")}`;
  }
  return errors;
};

export const validateUpdateInvoiceStatus = (body) => {
  const errors = {};
  if (!body.status) {
    errors.status = "Status is required";
  } else if (!INVOICE_STATUSES.includes(body.status)) {
    errors.status = `Invalid status '${body.status}'. Valid statuses are strictly: ${INVOICE_STATUSES.join(", ")}`;
  }
  return errors;
};

export default {
  validateCreateInvoice,
  validateUpdateInvoiceStatus,
};
