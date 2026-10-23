import express from 'express';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import Invoice from '../models/Invoice.js';
import { protect } from '../middleware/authMiddleware.js';
import { recalculateCustomerCredit } from '../services/invoiceService.js';
import { withCreditTransaction } from '../services/creditControlService.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();
router.use(protect, rateLimit({ windowMs: 60000, limit: 20, keyGenerator: req => String(req.user._id), standardHeaders: true, legacyHeaders: false }));
const requestPaystack = async (path, body) => {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error('Paystack is not configured. Please contact support.');
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok || !result.status) throw new Error(result.message || 'Payment service unavailable');
  return result.data;
};

export const settlePayment = async (reference) => {
  const payment = await Payment.findOne({ reference });
  if (!payment) throw new Error('Payment reference not found');
  const transaction = await requestPaystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (transaction.status !== 'success') return { status: transaction.status, reference };
  if (transaction.reference !== reference || transaction.amount !== payment.amount || transaction.currency !== payment.currency) {
    throw new Error('Payment amount or currency does not match');
  }
  // Commit payment, invoice and order together. Webhook retries cannot settle twice.
  await withCreditTransaction(payment.customer, async (session) => {
    const currentInvoice = payment.invoice ? await Invoice.findById(payment.invoice).session(session) : null;
    if (currentInvoice && Math.round(Number(currentInvoice.total) * 100) !== payment.amount) throw new Error('Invoice changed after payment began. Please contact support for reconciliation.');
    const claimed = await Payment.findOneAndUpdate(
      { _id: payment._id, status: { $ne: 'success' } },
      { $set: { status: 'success', paidAt: transaction.paid_at || new Date() } },
      { session, returnDocument: 'after' },
    );
    if (!claimed) return;
    if (payment.order) {
      await Order.updateOne({ _id: payment.order }, { $set: { paymentStatus: 'Confirmed', paymentMethod: 'paystack' } }, { session });
      await Order.updateOne({ _id: payment.order, status: { $in: ['Pending Payment', 'Awaiting Confirmation'] } }, { $set: { status: 'Processing' } }, { session });
    }
    if (payment.invoice) await Invoice.updateOne({ _id: payment.invoice }, { $set: { status: 'Paid', creditSettledAt: new Date() } }, { session });
  }, { enforce: false });
  return { status: 'success', reference, orderId: payment.order, invoiceId: payment.invoice };
};

export const paystackWebhook = async (req, res, next) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.get('x-paystack-signature') || '';
    if (!secret || !/^[a-f0-9]{128}$/i.test(signature)) return res.sendStatus(401);
    const expected = crypto.createHmac('sha512', secret).update(req.body).digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return res.sendStatus(401);
    const event = JSON.parse(req.body.toString('utf8'));
    if (event.event === 'charge.success') await settlePayment(event.data.reference);
    return res.sendStatus(200);
  } catch (error) { next(error); }
};

router.post('/initialize', protect, async (req, res, next) => {
  try {
    const order = req.body.orderId ? await Order.findOne({ _id: req.body.orderId, customer: req.user._id }) : null;
    const invoice = order?.invoice ? await Invoice.findById(order.invoice) : req.body.invoiceId ? await Invoice.findOne({ _id: req.body.invoiceId, customer: req.user._id }) : null;
    if (!order && !invoice) return res.status(404).json({ message: 'Order or invoice not found' });
    if (order?.paymentStatus === 'Confirmed' || invoice?.status === 'Paid') return res.status(409).json({ message: 'Already paid' });
    if (order?.status === 'Cancelled' || invoice?.status === 'Cancelled' || invoice?.status === 'Draft') return res.status(400).json({ message: 'This record cannot be paid' });
    const amount = Math.round(Number(invoice?.total ?? order.totalAmount) * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Invalid payment amount');
    const existing = await Payment.findOne({ customer: req.user._id, ...(invoice ? { invoice: invoice._id } : { order: order._id }), amount, status: 'pending', authorizationUrl: { $exists: true }, createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) } }).sort({ createdAt: -1 });
    if (existing?.accessCode) return res.json({ success: true, data: { reference: existing.reference, authorization_url: existing.authorizationUrl, access_code: existing.accessCode } });
    const payment = await Payment.create({ reference: `vinoff-${crypto.randomUUID()}`, customer: req.user._id, order: order?._id || invoice?.order, invoice: invoice?._id, amount });
    const clientUrl = process.env.PAYSTACK_CALLBACK_URL || `${String(process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '')}/payments/return`;
    const data = await requestPaystack('/transaction/initialize', { email: req.user.email, amount, currency: 'NGN', reference: payment.reference, callback_url: clientUrl });
    payment.authorizationUrl = data.authorization_url;
    payment.accessCode = data.access_code;
    await payment.save();
    return res.json({ success: true, data });
  } catch (error) { next(error); }
});
router.get('/verify/:reference', protect, async (req, res, next) => {
  try {
    const payment = await Payment.findOne({ reference: req.params.reference, customer: req.user._id });
    if (!payment) return res.status(404).json({ message: 'Payment not found' });
    return res.json({ success: true, data: await settlePayment(payment.reference) });
  } catch (error) { next(error); }
});
export default router;
