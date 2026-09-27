import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const isSafeMethod = (method) => ["GET", "HEAD", "OPTIONS"].includes(method);

const userOrIpKey = (req) =>
  req.user?._id ? `user:${req.user._id}` : `ip:${ipKeyGenerator(req.ip)}`;

const makeLimiter = ({ windowMs, max, message, keyGenerator = userOrIpKey, skip }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    skip,
    message: { success: false, message },
  });

export const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip)}`,
  message: "Too many sign-in attempts. Please try again in 15 minutes.",
});

export const registrationLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip)}`,
  message: "Too many registration attempts. Please try again in one hour.",
});

export const orderWriteLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many order changes. Please wait a few minutes and try again.",
});

export const paymentUploadLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many payment uploads. Please wait a few minutes and try again.",
});

export const chatMessageLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "You are sending messages too quickly. Please wait a moment.",
});

export const chatWriteLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: "Too many chat changes. Please wait a few minutes and try again.",
});

export const invoiceWriteLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: "Too many invoice changes. Please wait a few minutes and try again.",
});

export const productWriteLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many catalogue changes. Please wait a few minutes and try again.",
});

export const accountWriteLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skip: (req) => isSafeMethod(req.method),
  message: "Too many account changes. Please wait a few minutes and try again.",
});

export const adminWriteLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000,
  max: 120,
  skip: (req) => isSafeMethod(req.method),
  message: "Too many administrative changes. Please wait a few minutes and try again.",
});
