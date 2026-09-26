export const validateProduct = (body, isUpdate = false) => {
  const errors = {};
  if (!isUpdate || body.name !== undefined) {
    if (!body.name || !body.name.trim()) {
      errors.name = "Product name is required";
    }
  }
  if (!isUpdate || body.category !== undefined) {
    if (!body.category || !body.category.trim()) {
      errors.category = "Category is required";
    }
  }
  if (!isUpdate || body.price !== undefined) {
    if (body.price === undefined || isNaN(Number(body.price)) || Number(body.price) < 0) {
      errors.price = "Valid non-negative price is required";
    }
  }
  if (!isUpdate || body.wholesalePrice !== undefined) {
    if (body.wholesalePrice === undefined || isNaN(Number(body.wholesalePrice)) || Number(body.wholesalePrice) < 0) {
      errors.wholesalePrice = "Valid non-negative wholesale price is required";
    }
  }
  if (body.minimumQuantity !== undefined) {
    if (isNaN(Number(body.minimumQuantity)) || Number(body.minimumQuantity) < 1) {
      errors.minimumQuantity = "Minimum quantity must be at least 1";
    }
  }
  if (body.stock !== undefined) {
    if (isNaN(Number(body.stock)) || Number(body.stock) < 0) {
      errors.stock = "Stock must be a non-negative number";
    }
  }
  return errors;
};

export default {
  validateProduct,
};
