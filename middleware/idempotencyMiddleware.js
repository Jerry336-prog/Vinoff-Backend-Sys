import crypto from "crypto";
import IdempotencyKey from "../models/IdempotencyKey.js";
import { errorResponse } from "../utils/response.js";

const EXPIRY_MS = 24 * 60 * 60 * 1000;
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const fingerprintRequest = (req) => {
  const route = `${req.method}:${req.baseUrl}${req.path}`;
  const body = req.is("multipart/form-data") ? "multipart" : JSON.stringify(req.body || {});
  return crypto.createHash("sha256").update(`${route}:${body}`).digest("hex");
};

const cloneResponse = (body) => JSON.parse(JSON.stringify(body));

/**
 * Replays the original successful response for a repeated Idempotency-Key.
 * Mount this after authentication and before validation or file-upload middleware.
 */
export const idempotency = async (req, res, next) => {
  if (!UNSAFE_METHODS.has(req.method)) return next();

  const key = String(req.get("Idempotency-Key") || "").trim();
  if (!key) return next();
  if (key.length > 200) {
    return errorResponse(res, 400, "Idempotency-Key must not exceed 200 characters.");
  }

  const scope = req.user?._id
    ? `user:${req.user._id}`
    : `anonymous:${req.ip}`;
  const fingerprint = fingerprintRequest(req);

  try {
    let record = await IdempotencyKey.findOne({ scope, key });

    if (record) {
      if (record.fingerprint !== fingerprint) {
        return errorResponse(res, 409, "This Idempotency-Key was already used for a different request.");
      }
      if (record.state === "completed") {
        res.setHeader("Idempotent-Replayed", "true");
        return res.status(record.statusCode).json(record.responseBody);
      }
      return errorResponse(res, 409, "An identical request is already being processed. Please wait for it to finish.");
    }

    try {
      record = await IdempotencyKey.create({
        scope,
        key,
        fingerprint,
        expiresAt: new Date(Date.now() + EXPIRY_MS),
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      record = await IdempotencyKey.findOne({ scope, key });
      if (record?.state === "completed" && record.fingerprint === fingerprint) {
        res.setHeader("Idempotent-Replayed", "true");
        return res.status(record.statusCode).json(record.responseBody);
      }
      return errorResponse(res, 409, "An identical request is already being processed. Please wait for it to finish.");
    }

    const originalJson = res.json.bind(res);
    let responseCaptured = false;
    res.json = (body) => {
      if (responseCaptured) return originalJson(body);
      responseCaptured = true;

      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Do not release success until its replay data has been committed.
        void IdempotencyKey.updateOne(
          { _id: record._id },
          {
            $set: {
              state: "completed",
              statusCode: res.statusCode,
              responseBody: cloneResponse(body),
            },
          }
        )
          .then(() => originalJson(body))
          .catch((error) => {
            console.error("[Idempotency] Failed to save response:", error);
            res.status(503);
            originalJson({
              success: false,
              message: "Could not safely finalize this request. Please retry using the same Idempotency-Key.",
            });
          });
        return res;
      }

      void IdempotencyKey.deleteOne({ _id: record._id });
      return originalJson(body);
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

export default idempotency;
