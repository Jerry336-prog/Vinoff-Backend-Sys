import { ENV } from "../config/env.js";
import { errorResponse } from "../utils/response.js";

/**
 * Handle 404 routes
 */
export const notFound = (req, res, next) => {
  return errorResponse(res, 404, `Endpoint not found: ${req.method} ${req.originalUrl}`);
};

/**
 * Centralized global error handler
 */
export const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal server error";
  let errors = null;

  // Handle Mongoose Validation Error
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = "Database validation error";
    errors = Object.values(err.errors).map((e) => e.message);
  }

  // Handle Mongoose CastError (invalid ObjectId)
  if (err.name === "CastError") {
    statusCode = 400;
    message = `Resource not found with invalid identifier: ${err.value}`;
  }

  // Handle MongoDB Duplicate Key (E11000)
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || "field";
    message = `Duplicate value entered for unique index: ${field}`;
  }

  // Handle Multer upload limits/errors
  if (err.name === "MulterError") {
    statusCode = 400;
    message = `File upload error: ${err.message}`;
  }

  if (ENV.NODE_ENV !== "production") {
    console.error(`[Error Handler] ${req.method} ${req.originalUrl}:`, err);
  }

  return errorResponse(
    res,
    statusCode,
    message,
    errors || (ENV.NODE_ENV === "development" ? err.stack : null)
  );
};
