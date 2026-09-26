import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    type: { type: String, default: "image" },
    publicId: { type: String, default: "" },
    name: { type: String, default: "" },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: [true, "Chat reference is required"],
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    senderRole: {
      type: String,
      enum: ["customer", "admin", "subAdmin", "superadmin", "system"],
      required: true,
      index: true,
    },
    content: {
      type: String,
      trim: true,
      default: "",
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
    invoiceRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      default: null,
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

const Message = mongoose.model("Message", messageSchema);
export default Message;
