import { errorResponse } from "../utils/response.js";
import { isStaff, hasPermission, requiredPermissions } from '../utils/staffPermissions.js';

/**
 * Validation wrapper middleware that executes a validator function against req.body
 * @param {Function} validatorFn - returns an array of error messages or an object of errors
 */
export const validate = (validatorFn) => {
  return (req, res, next) => {
    // Multipart bodies are populated only after the upload middleware.
    if (isStaff(req.user) && requiredPermissions(req.method, req.originalUrl, req.body).some(key => !hasPermission(req.user, key))) return errorResponse(res, 403, 'Your account does not have permission to change these fields.');
    const errors = validatorFn(req.body, req);
    if (errors && Object.keys(errors).length > 0) {
      return errorResponse(res, 400, "Validation failed", errors);
    }
    next();
  };
};

export default validate;
