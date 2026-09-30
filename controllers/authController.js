import crypto from "crypto";
import User from "../models/User.js";
import { sendTokenResponse } from "../services/authService.js";
import { successResponse, errorResponse } from "../utils/response.js";
import { logActivity, notifyAdmins } from "../services/notificationService.js";
import { parseClientInfo } from "../utils/deviceParser.js";
import { sendWelcomeEmail } from "../services/emailService.js";

/**
 * Register a new customer
 * POST /api/auth/register
 */
export const register = async (req, res, next) => {
  try {
    const { firstName, lastName, email, phone, password, companyName, businessType } = req.body;

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return errorResponse(res, 400, "An account with this email already exists");
    }

    const sessionId = crypto.randomUUID();
    const clientInfo = parseClientInfo(req);

    const user = await User.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      phone: phone ? phone.trim() : "",
      password,
      role: "customer",
      profile: {
        companyName: companyName ? companyName.trim() : "",
        businessType: businessType ? businessType.trim() : "",
      },
      sessions: [
        {
          sessionId,
          device: clientInfo.device,
          browser: clientInfo.browser,
          os: clientInfo.os,
          ip: clientInfo.ip,
          userAgent: clientInfo.userAgent,
          lastActive: new Date(),
          createdAt: new Date(),
        },
      ],
    });

    await logActivity({
      actorId: user._id,
      action: "Customer registered",
      targetType: "User",
      targetId: user._id,
      description: `New customer registered: ${user.firstName} ${user.lastName} (${user.email})`,
    });

    await notifyAdmins({
      type: "CUSTOMER_REGISTERED",
      title: "New Customer Registered",
      message: `${user.firstName} ${user.lastName} (${user.email}) registered an account`,
      relatedUser: user._id,
    });

    // Send Welcome Email to newly registered customer (async without blocking response)
    sendWelcomeEmail({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    }).catch((err) => console.error("[Welcome Email Error]:", err.message));

    return sendTokenResponse(res, user, 201, "Registration successful", sessionId);
  } catch (error) {
    next(error);
  }
};

/**
 * User login
 * POST /api/auth/login
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password");
    if (!user) {
      return errorResponse(res, 401, "Invalid email or password");
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return errorResponse(res, 401, "Invalid email or password");
    }

    if (user.accountStatus === "suspended") {
      return errorResponse(res, 403, "Your account has been suspended. Please contact support.");
    }

    const sessionId = crypto.randomUUID();
    const clientInfo = parseClientInfo(req);

    if (!Array.isArray(user.sessions)) user.sessions = [];
    user.sessions.unshift({
      sessionId,
      device: clientInfo.device,
      browser: clientInfo.browser,
      os: clientInfo.os,
      ip: clientInfo.ip,
      userAgent: clientInfo.userAgent,
      lastActive: new Date(),
      createdAt: new Date(),
    });

    if (user.sessions.length > 15) {
      user.sessions = user.sessions.slice(0, 15);
    }

    await user.save({ validateBeforeSave: false });

    return sendTokenResponse(res, user, 200, "Login successful", sessionId);
  } catch (error) {
    next(error);
  }
};

/**
 * User logout
 * POST /api/auth/logout
 */
export const logout = (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });
  return successResponse(res, 200, "Logged out successfully");
};

/**
 * Get current authenticated user
 * GET /api/auth/me
 */
export const getMe = async (req, res) => {
  return successResponse(res, 200, "User profile retrieved", req.user);
};

export default {
  register,
  login,
  logout,
  getMe,
};
