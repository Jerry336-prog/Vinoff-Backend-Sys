export const creditError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export const parseCreditLimit = value => {
  if (value === '' || value === null || typeof value === 'boolean' || !['string', 'number'].includes(typeof value)) throw creditError('Enter a valid credit limit in NGN.');
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100)) || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw creditError('Credit limit must be a non-negative amount with at most two decimal places.');
  return Math.round(amount * 100) / 100;
};

export const assertCreditExposure = (customer, before, after) => {
  if (Math.round(after * 100) <= Math.round(before * 100)) return;
  if (!customer?.isVipCreditPartner || customer.role !== 'customer' || customer.accountStatus === 'suspended') throw creditError('Only active VIP credit partners can receive additional credit.', 403);
  const limit = Number(customer.creditLimit || 0);
  if (Math.round(after * 100) > Math.round(limit * 100)) throw creditError(`Credit limit exceeded. Approved limit: NGN ${limit.toLocaleString()}. Outstanding: NGN ${before.toLocaleString()}. Available: NGN ${Math.max(0, limit - before).toLocaleString()}. Pay with Paystack or contact the store for a limit review.`, 409);
};
