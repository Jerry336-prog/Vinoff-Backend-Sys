import jwt from "jsonwebtoken";
import { ENV } from "../config/env.js";

/**
 * Generates JWT token for user
 * @param {object} user
 */
export const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
    },
    ENV.JWT_SECRET,
    {
      expiresIn: ENV.JWT_EXPIRES_IN,
    }
  );
};

/**
 * Sends safe user response with cookie and token
 */
export const sendTokenResponse = (res, user, statusCode = 200, message = "Success") => {
  const token = generateToken(user);

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
