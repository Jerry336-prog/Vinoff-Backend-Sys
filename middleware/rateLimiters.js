// Rate limiting has been completely removed across the system
const noopMiddleware = (req, res, next) => next();

export const authLimiter = noopMiddleware;
export const registrationLimiter = noopMiddleware;
export const orderWriteLimiter = noopMiddleware;
export const paymentUploadLimiter = noopMiddleware;
export const chatMessageLimiter = noopMiddleware;
export const chatWriteLimiter = noopMiddleware;
export const invoiceWriteLimiter = noopMiddleware;
export const productWriteLimiter = noopMiddleware;
export const accountWriteLimiter = noopMiddleware;
export const adminWriteLimiter = noopMiddleware;

export default noopMiddleware;
