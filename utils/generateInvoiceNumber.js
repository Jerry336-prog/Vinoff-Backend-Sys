import crypto from "crypto";

/**
 * Generates a unique invoice number
 * Format: INV-YYYYMMDD-XXXX
 */
export const generateInvoiceNumber = () => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomSuffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `INV-${dateStr}-${randomSuffix}`;
};

export default generateInvoiceNumber;
