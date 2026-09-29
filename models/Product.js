import mongoose from "mongoose";

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: "" },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      trim: true,
      index: true,
    },
    images: {
      type: [imageSchema],
      default: [],
    },
    price: {
      type: Number,
      required: [true, "Regular price is required"],
      min: [0, "Price cannot be negative"],
    },
    wholesalePrice: {
      type: Number,
      required: [true, "Wholesale price is required"],
      min: [0, "Wholesale price cannot be negative"],
    },
    minimumQuantity: {
      type: Number,
      default: 1,
      min: [1, "Minimum quantity must be at least 1"],
    },
    stock: {
      type: Number,
      default: 0,
      min: [0, "Stock cannot be negative"],
    },
    unitStock: {
      type: Number,
      default: 0,
      min: [0, "Loose unit stock cannot be negative"],
    },
    trackUnitStock: {
      type: Boolean,
      default: false,
    },
    unit: {
      type: String,
      default: "carton",
      trim: true,
    },
    allowCarton: {
      type: Boolean,
      default: true,
    },
    allowPieces: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
    featured: {
      type: Boolean,
      default: false,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

productSchema.index({ name: "text", description: "text", category: "text" });

const Product = mongoose.model("Product", productSchema);
export default Product;
