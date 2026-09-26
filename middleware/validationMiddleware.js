import { errorResponse } from "../utils/response.js";

/**
 * Validation wrapper middleware that executes a validator function against req.body
 * @param {Function} validatorFn - returns an array of error messages or an object of errors
 */
export const validate = (validatorFn) => {
  return (req, res, next) => {
    const errors = validatorFn(req.body, req);
    if (errors && Object.keys(errors).length > 0) {
      return errorResponse(res, 400, "Validation failed", errors);
    }
    next();
  };
};

export default validate;
