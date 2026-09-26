export const validateCreateOrder = (body) => {
  const errors = {};
  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    errors.items = "Order must contain at least one item";
  } else {
    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i];
      if (!item.productId && !item.product) {
        errors[`items[${i}].product`] = "Product ID is required";
      }
      if (!item.quantity || isNaN(Number(item.quantity)) || Number(item.quantity) < 1) {
        errors[`items[${i}].quantity`] = "Quantity must be at least 1";
      }
    }
  }
  return errors;
};

export default {
  validateCreateOrder,
};
