/**
 * Standardized Success Response
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} message
 * @param {any} data
 * @param {object} [meta]
 */
export const successResponse = (res, statusCode = 200, message = "Operation successful", data = null, meta = undefined) => {
  const payload = {
    success: true,
    message,
    data,
  };
  if (meta !== undefined) {
    payload.meta = meta;
  }
  return res.status(statusCode).json(payload);
};

/**
 * Standardized Error Response
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} message
 * @param {any} error
 */
export const errorResponse = (res, statusCode = 500, message = "Something went wrong", error = null) => {
  return res.status(statusCode).json({
    success: false,
    message,
    error,
  });
};
