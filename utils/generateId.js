import crypto from "crypto";

/**
 * Generates a random alphanumeric string ID
 * @param {number} length
 */
export const generateId = (length = 16) => {
  return crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
};

export default generateId;
