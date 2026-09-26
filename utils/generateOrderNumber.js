import crypto from "crypto";

/**
 * Generates a unique order number
 * Format: VIN-ORD-YYYYMMDD-XXXX
 */
export const generateOrderNumber = () => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomSuffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `VIN-ORD-${dateStr}-${randomSuffix}`;
};

export default generateOrderNumber;
