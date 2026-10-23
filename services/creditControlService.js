import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import User from '../models/User.js';
import { assertCreditExposure, creditError } from '../utils/creditPolicy.js';

export const readCreditExposure = async (customerId, session) => {
  const result = await Invoice.aggregate([
    { $match: { customer: new mongoose.Types.ObjectId(String(customerId)), status: { $nin: ['Paid', 'Cancelled'] }, $or: [{ isCredit: true }, { status: 'On Credit' }] } },
    { $group: { _id: null, total: { $sum: '$total' } } },
  ]).session(session);
  return Math.round(Number(result[0]?.total || 0) * 100) / 100;
};

// Every credit-changing invoice mutation locks the same customer document inside
// its transaction. Concurrent checkouts/payments retry instead of overspending.
export const withCreditTransaction = (customerId, work, { enforce = true } = {}) => mongoose.connection.transaction(async session => {
  const customer = await User.findById(customerId).session(session);
  if (!customer) throw creditError('Customer not found.', 404);
  await User.updateOne({ _id: customerId }, { $inc: { creditLedgerVersion: 1 } }, { session });
  const before = await readCreditExposure(customerId, session);
  const result = await work(session, customer);
  const after = await readCreditExposure(customerId, session);
  if (enforce) assertCreditExposure(customer, before, after);
  await User.updateOne({ _id: customerId }, { $set: { outstandingCredit: after } }, { session });
  return result;
});
