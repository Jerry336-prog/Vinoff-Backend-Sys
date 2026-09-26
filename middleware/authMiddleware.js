import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { ENV } from "../config/env.js";
import { errorResponse } from "../utils/response.js";

/**
 * Protect routes - verifies JWT from Bearer header or cookies
 */
export const protect = async (req, res, next) => {
  try {
    let token = null;

    if (req.headers?.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return errorResponse(res, 401, "Access denied. Authentication token required.");
    }

    let decoded;
    try {
      decoded = jwt.verify(token, ENV.JWT_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return errorResponse(res, 401, "Session expired. Please log in again.");
      }
      return errorResponse(res, 401, "Invalid authentication token.");
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return errorResponse(res, 401, "User belonging to this token no longer exists.");
    }

    if (user.accountStatus === "suspended") {
      return errorResponse(res, 403, "Your account has been suspended. Please contact support.");
    }

    req.user = user;
    next();
  } catch (error) {
    return errorResponse(res, 500, "Authentication processing error", error.message);
  }
};

export default protect;
