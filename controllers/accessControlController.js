import mongoose from 'mongoose';
import User from '../models/User.js';
import CreditLimitRequest from '../models/CreditLimitRequest.js';
import Notification from '../models/Notification.js';
import { STAFF_PERMISSIONS, hasPermission } from '../utils/staffPermissions.js';
import { parseCreditLimit, creditError } from '../utils/creditPolicy.js';
import { logActivity } from '../services/notificationService.js';
import { successResponse } from '../utils/response.js';

const person = user => `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
const populateRequest = query => query.populate('customer', 'firstName lastName email creditLimit outstandingCredit isVipCreditPartner')
  .populate('requestedBy', 'firstName lastName email').populate('reviewedBy', 'firstName lastName email');

export const getStaff = async (req, res, next) => {
  try {
    const staff = await User.find({ role: { $in: ['admin', 'subAdmin', 'superadmin'] } }).select('firstName lastName email role staffPermissions accountStatus').sort({ firstName: 1 });
    return successResponse(res, 200, 'Staff permissions', { staff, permissions: STAFF_PERMISSIONS });
  } catch (error) { next(error); }
};

export const setStaffPermissions = async (req, res, next) => {
  try {
    if (req.user.role !== 'superadmin') throw creditError('Only the super admin can change staff permissions.', 403);
    const permissions = req.body.permissions;
    if (!Array.isArray(permissions) || permissions.some(key => !STAFF_PERMISSIONS.includes(key))) throw creditError('Choose valid staff permissions.');
    const target = await User.findOne({ _id: req.params.id, role: { $in: ['admin', 'subAdmin'] } });
    if (!target) throw creditError('Only ordinary admin accounts can have their permissions edited.', 404);
    const before = [...target.staffPermissions];
    target.staffPermissions = [...new Set(permissions)];
    await target.save();
    await logActivity({ actorId: req.user._id, action: 'Superadmin updated staff permissions', targetType: 'User', targetId: target._id, description: `Permissions updated for ${target.email}`, metadata: { before, after: target.staffPermissions } });
    return successResponse(res, 200, 'Staff permissions saved. Changes apply to the next request.', target);
  } catch (error) { next(error); }
};

export const getCreditRequests = async (req, res, next) => {
  try {
    const query = req.user.role === 'superadmin' ? {} : { requestedBy: req.user._id };
    if (req.query.status) query.status = req.query.status;
    const requests = await populateRequest(CreditLimitRequest.find(query).sort({ createdAt: -1 }).limit(200));
    return successResponse(res, 200, 'Credit limit requests', requests);
  } catch (error) { next(error); }
};

export const requestCreditLimit = async (req, res, next) => {
  try {
    if (!hasPermission(req.user, 'credit.request')) throw creditError('You do not have permission to request credit changes.', 403);
    const limit = parseCreditLimit(req.body.creditLimit);
    const reason = String(req.body.reason || '').trim();
    if (!reason || reason.length > 1000) throw creditError('Provide a reason of 1 to 1,000 characters.');
    const result = await mongoose.connection.transaction(async session => {
      const customer = await User.findOne({ _id: req.params.id, role: 'customer', isVipCreditPartner: true }).session(session);
      if (!customer) throw creditError('An active VIP credit partner is required.', 404);
      if (customer.accountStatus === 'suspended') throw creditError('Reactivate this customer before changing their credit limit.');
      const previousLimit = Number(customer.creditLimit || 0);
      if (limit === previousLimit) throw creditError('This is already the approved credit limit.');
      const direct = req.user.role === 'superadmin';
      if (direct) {
        const pending = await CreditLimitRequest.find({ customer: customer._id, status: 'pending' }).session(session);
        await Notification.updateMany({ relatedApproval: { $in: pending.map(item => item._id) } }, { $set: { read: true } }, { session });
        await CreditLimitRequest.updateMany({ customer: customer._id, status: 'pending' }, { $set: { status: 'superseded', reviewedBy: req.user._id, reviewedAt: new Date(), reviewNote: 'The super admin changed this limit directly.' } }, { session });
      }
      const [request] = await CreditLimitRequest.create([{
        customer: customer._id, requestedBy: req.user._id, previousLimit, requestedLimit: limit,
        limitVersion: Number(customer.creditLimitVersion || 0), reason,
        status: direct ? 'approved' : 'pending', ...(direct ? { reviewedBy: req.user._id, reviewedAt: new Date() } : {}),
      }], { session });
      if (direct) {
        customer.creditLimit = limit;
        customer.creditLimitVersion = Number(customer.creditLimitVersion || 0) + 1;
        await customer.save({ session });
        await Notification.create([{ recipient: customer._id, type: 'VIP_CREDIT_UPDATED', title: 'Credit limit updated', message: `Your approved credit limit is now NGN ${limit.toLocaleString()}.`, relatedUser: customer._id }], { session });
      } else {
        await User.updateOne({ _id: customer._id }, { $inc: { creditLedgerVersion: 1 } }, { session });
        const owners = await User.find({ role: 'superadmin', accountStatus: 'active' }).session(session);
        if (!owners.length) throw creditError('No active super admin is available to approve this request.', 409);
        await Notification.insertMany(owners.map(owner => ({ recipient: owner._id, type: 'CREDIT_LIMIT_REQUESTED', title: 'Credit limit approval required', message: `${person(req.user)} requests changing ${person(customer)}'s limit from NGN ${previousLimit.toLocaleString()} to NGN ${limit.toLocaleString()}. Reason: ${reason}`, relatedUser: customer._id, relatedApproval: request._id })), { session });
      }
      return { customer, request, pending: !direct };
    });
    await logActivity({ actorId: req.user._id, action: result.pending ? 'Admin requested credit limit change' : 'Superadmin changed credit limit', targetType: 'User', targetId: req.params.id, description: reason, metadata: { requestId: result.request._id, previousLimit: result.request.previousLimit, requestedLimit: limit } });
    return successResponse(res, 201, result.pending ? 'Request sent to the super admin. The current limit is unchanged.' : 'Credit limit updated.', result);
  } catch (error) {
    if (error.code === 11000) return next(creditError('This customer already has a pending limit request. Review that request first.', 409));
    next(error);
  }
};

export const reviewCreditRequest = async (req, res, next) => {
  try {
    if (req.user.role !== 'superadmin') throw creditError('Only the super admin can review credit limit requests.', 403);
    if (!['approved', 'rejected'].includes(req.body.decision)) throw creditError('Choose approve or reject.');
    const note = String(req.body.note || '').trim();
    if (note.length > 1000) throw creditError('Review note cannot exceed 1,000 characters.');
    const request = await mongoose.connection.transaction(async session => {
      const current = await CreditLimitRequest.findById(req.params.id).session(session);
      if (!current) throw creditError('Request not found.', 404);
      if (current.status !== 'pending') throw creditError('This request has already been reviewed.', 409);
      const customer = await User.findById(current.customer).session(session);
      if (!customer) throw creditError('Customer not found.', 404);
      const stale = Number(customer.creditLimitVersion || 0) !== current.limitVersion || Number(customer.creditLimit || 0) !== current.previousLimit;
      const requester = await User.findById(current.requestedBy).session(session);
      if (requester) await User.updateOne({ _id: requester._id }, { $inc: { creditLedgerVersion: 1 } }, { session });
      const eligible = customer.role === 'customer' && customer.isVipCreditPartner && customer.accountStatus === 'active' && requester?.accountStatus === 'active' && hasPermission(requester, 'credit.request');
      current.status = req.body.decision === 'approved' && (stale || !eligible) ? 'superseded' : req.body.decision;
      current.reviewedBy = req.user._id;
      current.reviewedAt = new Date();
      current.reviewNote = current.status === 'superseded' ? 'Account, permission or limit changed. Submit a new request.' : note;
      if (current.status === 'approved') {
        customer.creditLimit = current.requestedLimit;
        customer.creditLimitVersion = Number(customer.creditLimitVersion || 0) + 1;
        await customer.save({ session });
        await Notification.create([{ recipient: customer._id, type: 'VIP_CREDIT_UPDATED', title: 'Credit limit updated', message: `Your approved credit limit is now NGN ${current.requestedLimit.toLocaleString()}.`, relatedUser: customer._id }], { session });
      }
      await current.save({ session });
      await Notification.updateMany({ relatedApproval: current._id }, { $set: { read: true } }, { session });
      await Notification.create([{ recipient: current.requestedBy, type: 'CREDIT_LIMIT_REVIEWED', title: `Credit limit request ${current.status}`, message: `${person(req.user)} ${current.status} your request for ${person(customer)}. ${current.reviewNote}`, relatedUser: customer._id, relatedApproval: current._id }], { session });
      return current;
    });
    await logActivity({ actorId: req.user._id, action: `Superadmin ${request.status} credit limit request`, targetType: 'User', targetId: request.customer, description: request.reviewNote || `Credit limit request ${request.status}: NGN ${request.previousLimit} to NGN ${request.requestedLimit}`, metadata: { requestId: request._id, requestedBy: request.requestedBy, previousLimit: request.previousLimit, requestedLimit: request.requestedLimit } });
    return successResponse(res, 200, `Request ${request.status}.`, request);
  } catch (error) { next(error); }
};
