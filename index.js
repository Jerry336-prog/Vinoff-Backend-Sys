import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { connectDB } from "./config/db.js";
import { ENV } from "./config/env.js";

// Routes
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import announcementRoutes from "./routes/announcementRoutes.js";
import settingRoutes from "./routes/settingRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";

// Middleware
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";

const app = express();

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// CORS configuration
const allowedOrigins = [
  ENV.CLIENT_URL,
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Idempotency-Key"],
  })
);

// Rate limiter for API routes
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // Fast recovery if a browser has a request loop
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP. Please try again in one minute.",
  },
});

app.use("/api", apiLimiter);

// Body parsers & cookies
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

// Health Check Endpoint
app.get("/api/health", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Vinoff API is running",
  });
});

// Root endpoint
app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Welcome to Vinoff Wholesale E-Commerce API",
    version: "1.0.0",
    docs: "/api/health",
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/settings", settingRoutes);
app.use("/api/analytics", analyticsRoutes);

// Catch 404 & Centralized Error Handler
app.use(notFound);
app.use(errorHandler);

// Server Startup
const PORT = ENV.PORT || 8080;

const startServer = async () => {
  try {
    await connectDB();

    const server = app.listen(PORT, () => {
      console.log(`=========================================`);
      console.log(` Vinoff Wholesale Backend Running`);
      console.log(` Environment: ${ENV.NODE_ENV}`);
      console.log(` Port:        ${PORT}`);
      console.log(` Health:      http://localhost:${PORT}/api/health`);
      console.log(`=========================================`);
    });

    const handleShutdown = (signal) => {
      console.log(`[Server] Received ${signal}. Closing HTTP server...`);
      server.close(() => {
        console.log("[Server] HTTP server closed. Process exiting.");
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));
  } catch (error) {
    console.error("[Server Error] Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

export { app };
export default app;
