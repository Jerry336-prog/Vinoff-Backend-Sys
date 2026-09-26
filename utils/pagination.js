/**
 * Extracts and sanitizes pagination query parameters
 * @param {import('express').Request} req
 * @param {number} defaultLimit
 */
export const getPagination = (req, defaultLimit = 20) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || defaultLimit));
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

/**
 * Formats paginated response payload
 * @param {Array} items
 * @param {number} totalItems
 * @param {number} page
 * @param {number} limit
 */
export const formatPaginatedResponse = (items, totalItems, page, limit) => {
  const totalPages = Math.ceil(totalItems / limit) || 1;
  return {
    items,
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
};
