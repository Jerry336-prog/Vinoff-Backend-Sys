import User from "../models/User.js";
import { sendTokenResponse } from "../services/authService.js";
import { successResponse, errorResponse } from "../utils/response.js";
import { logActivity, notifyAdmins } from "../services/notificationService.js";

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

    return sendTokenResponse(res, user, 201, "Registration successful");
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

    return sendTokenResponse(res, user, 200, "Login successful");
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
