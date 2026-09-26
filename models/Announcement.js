import mongoose from "mongoose";

export const ANNOUNCEMENT_TYPES = ["general", "new_product", "maintenance", "alert"];
export const ANNOUNCEMENT_TARGETS = ["all", "specific_customer"];
export const ANNOUNCEMENT_PRIORITIES = ["normal", "high", "urgent"];
export const ANNOUNCEMENT_STATUSES = ["active", "dismissed", "expired"];

const announcementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Announcement title is required"],
      trim: true,
    },
    message: {
      type: String,
      required: [true, "Announcement message body is required"],
      trim: true,
    },
    type: {
      type: String,
      enum: ANNOUNCEMENT_TYPES,
      default: "general",
      index: true,
    },
    target: {
      type: String,
      enum: ANNOUNCEMENT_TARGETS,
      default: "all",
      index: true,
    },
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    actionUrl: {
      type: String,
      trim: true,
      default: "",
    },
    actionText: {
      type: String,
      trim: true,
      default: "",
    },
    imageUrl: {
      type: String,
      trim: true,
      default: "",
    },
    priority: {
      type: String,
      enum: ANNOUNCEMENT_PRIORITIES,
      default: "normal",
    },
    status: {
      type: String,
      enum: ANNOUNCEMENT_STATUSES,
      default: "active",
      index: true,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    // Track user IDs who have clicked "Dismiss" / "Got It" on the modal popup
    dismissedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const Announcement = mongoose.model("Announcement", announcementSchema);
export default Announcement;
