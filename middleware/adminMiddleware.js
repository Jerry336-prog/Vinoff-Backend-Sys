import { errorResponse } from "../utils/response.js";

/**
 * Restricts route access to specified roles (e.g. admin, subAdmin, superadmin)
 * Defaults to ['admin', 'subAdmin', 'superadmin']
 * @param {string[]} [allowedRoles]
 */
export const authorize = (allowedRoles = ["admin", "subAdmin", "superadmin"]) => {
  return (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 401, "Authentication required");
    }

    if (!allowedRoles.includes(req.user.role)) {
      return errorResponse(
        res,
        403,
        `Access denied. You do not have sufficient permissions (${req.user.role}).`
      );
    }

    next();
  };
};

export const adminOnly = authorize(["admin", "superadmin"]);
export const adminOrSubAdmin = authorize(["admin", "subAdmin", "superadmin"]);
export const superAdminOnly = authorize(["superadmin"]);

export default authorize;
