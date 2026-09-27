import mongoose from "mongoose";

const idempotencyKeySchema = new mongoose.Schema(
  {
    scope: { type: String, required: true },
    key: { type: String, required: true, maxlength: 200 },
    fingerprint: { type: String, required: true },
    state: { type: String, enum: ["processing", "completed"], default: "processing" },
    statusCode: { type: Number },
    responseBody: { type: mongoose.Schema.Types.Mixed },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// A key belongs to one authenticated actor and one logical write operation.
idempotencyKeySchema.index({ scope: 1, key: 1 }, { unique: true });
idempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("IdempotencyKey", idempotencyKeySchema);
