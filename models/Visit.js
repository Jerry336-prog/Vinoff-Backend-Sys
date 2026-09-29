import mongoose from "mongoose";

const visitSchema = new mongoose.Schema(
  {
    visitorId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    sessionId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    source: {
      type: String,
      required: true,
      enum: [
        "TikTok",
        "Instagram",
        "WhatsApp",
        "Google Search",
        "Facebook",
        "X (Twitter)",
        "Direct / Browser",
        "Other Referral",
      ],
      default: "Direct / Browser",
      index: true,
    },
    referrer: {
      type: String,
      default: "",
      trim: true,
    },
    path: {
      type: String,
      default: "/",
      trim: true,
      index: true,
    },
    landingPage: {
      type: String,
      default: "/",
      trim: true,
    },
    utmSource: {
      type: String,
      default: "",
      trim: true,
    },
    utmMedium: {
      type: String,
      default: "",
      trim: true,
    },
    utmCampaign: {
      type: String,
      default: "",
      trim: true,
    },
    device: {
      type: String,
      enum: ["mobile", "desktop", "tablet", "unknown"],
      default: "unknown",
      index: true,
    },
    browser: {
      type: String,
      default: "Other",
      trim: true,
    },
    os: {
      type: String,
      default: "Other",
      trim: true,
    },
    ip: {
      type: String,
      default: "",
    },
    isNewVisitor: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for analytics aggregation queries
visitSchema.index({ createdAt: -1 });
visitSchema.index({ source: 1, createdAt: -1 });
visitSchema.index({ device: 1, createdAt: -1 });
visitSchema.index({ visitorId: 1, createdAt: -1 });

export const Visit = mongoose.model("Visit", visitSchema);
export default Visit;
