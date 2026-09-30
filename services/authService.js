import jwt from "jsonwebtoken";
import { ENV } from "../config/env.js";

/**
 * Generates JWT token for user with optional sessionId
 * @param {object} user
 * @param {string|null} sessionId
 */
export const generateToken = (user, sessionId = null) => {
  const payload = {
    id: user._id,
    email: user.email,
    role: user.role,
  };
  if (sessionId) {
    payload.sessionId = sessionId;
  }
  return jwt.sign(
    payload,
    ENV.JWT_SECRET,
    {
      expiresIn: ENV.JWT_EXPIRES_IN,
    }
  );
};

/**
 * Sends safe user response with cookie and token
 */
export const sendTokenResponse = (res, user, statusCode = 200, message = "Success", sessionId = null) => {
  const token = generateToken(user, sessionId);

  // Cookie options
  const isProd = ENV.NODE_ENV === "production";
  const cookieOptions = {
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
  };

  res.cookie("token", token, cookieOptions);

  const safeUser = user.toObject ? user.toObject() : { ...user };
  delete safeUser.password;

  return res.status(statusCode).json({
    success: true,
    message,
    data: {
      user: safeUser,
      token,
    },
  });
};

export default {
  generateToken,
  sendTokenResponse,
};
