import Product from "../models/Product.js";
import { uploadBuffer, deleteResource } from "../services/cloudinaryService.js";
import { getPagination, formatPaginatedResponse } from "../utils/pagination.js";
import { successResponse, errorResponse } from "../utils/response.js";
import { logActivity } from "../services/notificationService.js";

/**
 * Get all products with search, filter, sort and pagination
 * GET /api/products
 */
export const getProducts = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req, 20);
    const { search, category, status, featured, sort } = req.query;

    const query = {};

    // For customers, only show active products by default unless status is specified by admin
    if (status) {
      query.status = status;
    } else if (!req.user || req.user.role === "customer") {
      query.status = "active";
    }

    if (category) {
      query.category = { $regex: new RegExp(`^${category}$`, "i") };
    }

    if (featured !== undefined) {
      query.featured = featured === "true";
    }

    if (search && search.trim()) {
      query.$or = [
        { name: { $regex: search.trim(), $options: "i" } },
        { description: { $regex: search.trim(), $options: "i" } },
        { category: { $regex: search.trim(), $options: "i" } },
      ];
    }

    // Sort options
    let sortOptions = { createdAt: -1 };
    if (sort === "price_asc") {
      sortOptions = { wholesalePrice: 1 };
    } else if (sort === "price_desc") {
      sortOptions = { wholesalePrice: -1 };
    } else if (sort === "name") {
      sortOptions = { name: 1 };
    } else if (sort === "newest") {
      sortOptions = { createdAt: -1 };
    }

    const [products, totalCount] = await Promise.all([
      Product.find(query).sort(sortOptions).skip(skip).limit(limit),
      Product.countDocuments(query),
    ]);

    const result = formatPaginatedResponse(products, totalCount, page, limit);
    return successResponse(res, 200, "Products retrieved successfully", result.items, result.pagination);
  } catch (error) {
    next(error);
  }
};

/**
 * Get single product by ID
 * GET /api/products/:id
 */
export const getProductById = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return errorResponse(res, 404, "Product not found");
    }
    return successResponse(res, 200, "Product retrieved successfully", product);
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new product (Admin only)
 * POST /api/products
 */
export const createProduct = async (req, res, next) => {
  try {
    const {
      name,
      description,
      category,
      price,
      wholesalePrice,
      minimumQuantity,
      stock,
      unitStock,
      unit,
      featured,
      status,
    } = req.body;

    const uploadedImages = [];

    // Handle files uploaded through Multer
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const uploadResult = await uploadBuffer(file.buffer, "vinoff_products");
        uploadedImages.push({
          url: uploadResult.url,
          publicId: uploadResult.publicId,
        });
      }
    } else if (req.file) {
      const uploadResult = await uploadBuffer(req.file.buffer, "vinoff_products");
      uploadedImages.push({
        url: uploadResult.url,
        publicId: uploadResult.publicId,
      });
    }

    // Support pre-uploaded image array in body
    if (req.body.images) {
      const bodyImages = Array.isArray(req.body.images)
        ? req.body.images
        : [req.body.images];
      for (const img of bodyImages) {
        if (typeof img === "string") {
          uploadedImages.push({ url: img, publicId: "" });
        } else if (img && img.url) {
          uploadedImages.push(img);
        }
      }
    }

    const product = await Product.create({
      name: name.trim(),
      description: description ? description.trim() : "",
      category: category.trim(),
      images: uploadedImages,
      price: Number(price),
      wholesalePrice: Number(wholesalePrice),
      minimumQuantity: minimumQuantity ? Number(minimumQuantity) : 1,
      stock: stock !== undefined ? Number(stock) : 0,
      unitStock: unitStock !== undefined ? Number(unitStock) : 0,
      unit: unit ? unit.trim() : "carton",
      featured: featured === true || featured === "true",
      status: status || "active",
      createdBy: req.user._id,
    });

    await logActivity({
      actorId: req.user._id,
      action: "Admin created product",
      targetType: "Product",
      targetId: product._id,
      description: `Admin created product '${product.name}'`,
      metadata: { productId: product._id, price: product.price, wholesalePrice: product.wholesalePrice },
    });

    return successResponse(res, 201, "Product created successfully", product);
  } catch (error) {
    next(error);
  }
};

/**
 * Update an existing product (Admin only)
 * PATCH /api/products/:id
 */
export const updateProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return errorResponse(res, 404, "Product not found");
    }

    const updateFields = { ...req.body };

    // Handle new images uploaded
    if (req.files && req.files.length > 0) {
      const newImages = [];
      for (const file of req.files) {
        const uploadResult = await uploadBuffer(file.buffer, "vinoff_products");
        newImages.push({
          url: uploadResult.url,
          publicId: uploadResult.publicId,
        });
      }
      // If appendImages is true, append to existing images, otherwise replace
      if (req.body.appendImages === "true" || req.body.appendImages === true) {
        product.images.push(...newImages);
      } else {
        product.images = newImages;
      }
      delete updateFields.images;
    }

    Object.assign(product, updateFields);
    await product.save();

    await logActivity({
      actorId: req.user._id,
      action: "Admin updated product",
      targetType: "Product",
      targetId: product._id,
      description: `Admin updated product '${product.name}'`,
    });

    return successResponse(res, 200, "Product updated successfully", product);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a product (Admin only)
 * DELETE /api/products/:id
 */
export const deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return errorResponse(res, 404, "Product not found");
    }

    // Clean up Cloudinary images if publicId exists
    for (const img of product.images) {
      if (img.publicId) {
        await deleteResource(img.publicId);
      }
    }

    await Product.findByIdAndDelete(req.params.id);

    await logActivity({
      actorId: req.user._id,
      action: "Admin deleted product",
      targetType: "Product",
      targetId: product._id,
      description: `Admin deleted product '${product.name}'`,
    });

    return successResponse(res, 200, "Product deleted successfully");
  } catch (error) {
    next(error);
  }
};

export default {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
