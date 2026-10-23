import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Invoice from '../models/Invoice.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import Notification from '../models/Notification.js';
import CreditLimitRequest from '../models/CreditLimitRequest.js';
import { requestCreditLimit, reviewCreditRequest, setStaffPermissions } from '../controllers/accessControlController.js';
import { createCustomInvoice, updateInvoiceDetails, deleteInvoiceRecord } from '../services/invoiceService.js';
import { createOrder } from '../services/orderService.js';
import { getReorderPreview } from '../controllers/orderController.js';
import { settlePayment } from '../routes/paymentRoutes.js';
import Payment from '../models/Payment.js';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import adminRoutes from '../routes/adminRoutes.js';
import orderRoutes from '../routes/orderRoutes.js';
import invoiceRoutes from '../routes/invoiceRoutes.js';
import { ENV } from '../config/env.js';
import { errorHandler } from '../middleware/errorMiddleware.js';

const uri = process.env.VINOFF_TEST_MONGO_URI;
const call = async (controller, req) => {
  const res = { status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; } };
  let error;
  await controller(req, res, cause => { error = cause; });
  if (error) throw error;
  return res;
};

test('isolated replica-set credit, approval, payment and reorder integration', { skip: !uri, timeout: 120000 }, async t => {
  // Never permit this destructive fixture setup to target a real database.
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:27028\/vinoff_credit_qa(?:\?|$)/);
  process.env.EMAIL_USER = ''; process.env.EMAIL_PASS = ''; process.env.RESEND_API_KEY = ''; process.env.BREVO_API_KEY = '';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  t.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const makeUser = async data => {
    const result = await User.collection.insertOne({ firstName: 'QA', lastName: 'Account', email: `qa-${new mongoose.Types.ObjectId()}@example.test`, password: 'not-a-login', role: 'customer', accountStatus: 'active', creditLimit: 0, creditLimitVersion: 0, outstandingCredit: 0, staffPermissions: [], ...data });
    return User.findById(result.insertedId);
  };
  const owner = await makeUser({ role: 'superadmin' });
  const admin = await makeUser({ role: 'admin', staffPermissions: ['credit.request'] });
  const makeVip = limit => makeUser({ isVipCreditPartner: true, creditLimit: limit || 0 });
  const invoiceData = (customer, total) => ({ customer: customer._id, items: [{ description: 'QA Goods', quantity: 1, unitPrice: total }], isCredit: true, createdBy: admin._id });

  await t.test('admin request does not change limit; superadmin receives exact amount and approves once', async () => {
    const customer = await makeVip(100);
    const created = await call(requestCreditLimit, { user: admin, params: { id: customer._id }, body: { creditLimit: 500, reason: 'Reliable repayment', status: 'approved' } });
    const request = created.body.data.request;
    assert.equal(created.body.data.pending, true);
    assert.equal((await User.findById(customer._id)).creditLimit, 100);
    const alert = await Notification.findOne({ recipient: owner._id, relatedApproval: request._id });
    assert.ok(alert); assert.match(alert.message, /500/);
    await assert.rejects(call(reviewCreditRequest, { user: admin, params: { id: request._id }, body: { decision: 'approved' } }), error => error.statusCode === 403);
    await call(reviewCreditRequest, { user: owner, params: { id: request._id }, body: { decision: 'approved' } });
    assert.equal((await User.findById(customer._id)).creditLimit, 500);
    assert.equal((await Notification.findById(alert._id)).read, true);
    await assert.rejects(call(reviewCreditRequest, { user: owner, params: { id: request._id }, body: { decision: 'approved' } }), error => error.statusCode === 409);
  });

  await t.test('duplicate pending requests reject and a rejected request leaves limit unchanged', async () => {
    const customer = await makeVip(100);
    const request = (await call(requestCreditLimit, { user: admin, params: { id: customer._id }, body: { creditLimit: 200, reason: 'Review' } })).body.data.request;
    await assert.rejects(call(requestCreditLimit, { user: admin, params: { id: customer._id }, body: { creditLimit: 300, reason: 'Duplicate' } }), error => error.statusCode === 409);
    await call(reviewCreditRequest, { user: owner, params: { id: request._id }, body: { decision: 'rejected' } });
    assert.equal((await User.findById(customer._id)).creditLimit, 100);
  });

  await t.test('changed VIP status supersedes an old approval and direct owner changes supersede pending requests', async () => {
    const customer = await makeVip(100);
    const request = (await call(requestCreditLimit, { user: admin, params: { id: customer._id }, body: { creditLimit: 200, reason: 'Review' } })).body.data.request;
    await User.updateOne({ _id: customer._id }, { $set: { isVipCreditPartner: false } });
    const response = await call(reviewCreditRequest, { user: owner, params: { id: request._id }, body: { decision: 'approved' } });
    assert.equal(response.body.data.status, 'superseded');
    assert.equal((await User.findById(customer._id)).creditLimit, 100);
    await User.updateOne({ _id: customer._id }, { $set: { isVipCreditPartner: true } });
    const pending = (await call(requestCreditLimit, { user: admin, params: { id: customer._id }, body: { creditLimit: 200, reason: 'Review again' } })).body.data.request;
    await call(requestCreditLimit, { user: owner, params: { id: customer._id }, body: { creditLimit: 150, reason: 'Owner decision' } });
    assert.equal((await CreditLimitRequest.findById(pending._id)).status, 'superseded');
    assert.equal((await User.findById(customer._id)).creditLimit, 150);
  });

  await t.test('only superadmin can change staff permissions; customers cannot self-grant', async () => {
    await assert.rejects(call(setStaffPermissions, { user: admin, params: { id: admin._id }, body: { permissions: ['settings.manage'] } }), error => error.statusCode === 403);
    await call(setStaffPermissions, { user: owner, params: { id: admin._id }, body: { permissions: ['credit.request', 'customers.view'] } });
    assert.deepEqual(Array.from((await User.findById(admin._id)).staffPermissions), ['credit.request', 'customers.view']);
    await assert.rejects(call(setStaffPermissions, { user: owner, params: { id: admin._id }, body: { permissions: ['approve.anything'] } }));
  });

  await t.test('simultaneous credit invoices cannot exceed one shared limit', async () => {
    const customer = await makeVip(100);
    const results = await Promise.allSettled([createCustomInvoice(invoiceData(customer, 70)), createCustomInvoice(invoiceData(customer, 70))]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await User.findById(customer._id)).outstandingCredit, 70);
    assert.equal(await Invoice.countDocuments({ customer: customer._id }), 1);
  });

  await t.test('zero-limit and non-VIP credit fail; edits enforce cap and cancellation/deletion free allowance', async () => {
    const customer = await makeVip(0);
    await assert.rejects(createCustomInvoice(invoiceData(customer, 1)), /exceeded/);
    const ordinary = await makeUser({ creditLimit: 100 });
    await assert.rejects(createCustomInvoice(invoiceData(ordinary, 1)), /VIP/);
    await User.updateOne({ _id: customer._id }, { $set: { creditLimit: 100 } });
    const invoice = await createCustomInvoice(invoiceData(customer, 80));
    await assert.rejects(updateInvoiceDetails(invoice._id, { items: [{ description: 'QA', quantity: 1, unitPrice: 120 }] }, admin._id), /exceeded/);
    assert.equal((await Invoice.findById(invoice._id)).total, 80);
    await updateInvoiceDetails(invoice._id, { status: 'Cancelled' }, admin._id);
    assert.equal((await User.findById(customer._id)).outstandingCredit, 0);
    await updateInvoiceDetails(invoice._id, { status: 'On Credit' }, admin._id);
    assert.equal((await User.findById(customer._id)).outstandingCredit, 80);
    await deleteInvoiceRecord(invoice._id);
    assert.equal((await User.findById(customer._id)).outstandingCredit, 0);
  });

  await t.test('concurrent credit checkout commits only affordable order and restores failed inventory', async () => {
    const customer = await makeVip(100);
    const product = await Product.create({ name: 'QA Stock', category: 'QA', price: 70, wholesalePrice: 70, stock: 10, unitStock: 5 });
    const args = { customerId: customer._id, items: [{ product: product._id, quantity: 1 }], isCreditOrder: true };
    const results = await Promise.allSettled([createOrder(args), createOrder(args)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await Order.countDocuments({ customer: customer._id }), 1);
    assert.equal((await Product.findById(product._id)).stock, 9);
    assert.equal((await User.findById(customer._id)).outstandingCredit, 70);
    const ordinary = await makeUser({});
    const paidCheckout = await createOrder({ ...args, customerId: ordinary._id, isCreditOrder: false, paymentMethod: 'paystack' });
    assert.equal(paidCheckout.order.paymentStatus, 'Pending');
    assert.equal((await User.findById(ordinary._id)).outstandingCredit, 0);
  });

  await t.test('verified payment frees allowance exactly once and never calls a real payment provider', async () => {
    const customer = await makeVip(100);
    const invoice = await createCustomInvoice(invoiceData(customer, 80));
    const payment = await Payment.create({ reference: `qa-${invoice._id}`, customer: customer._id, invoice: invoice._id, amount: 8000 });
    const oldFetch = globalThis.fetch; const oldKey = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_fixture';
    globalThis.fetch = async url => { assert.match(String(url), /^https:\/\/api\.paystack\.co\/transaction\/verify\//); return { ok: true, json: async () => ({ status: true, data: { reference: payment.reference, amount: 8000, currency: 'NGN', status: 'success' } }) }; };
    try {
      await Promise.all([settlePayment(payment.reference), settlePayment(payment.reference)]);
      assert.equal((await User.findById(customer._id)).outstandingCredit, 0);
      assert.equal((await Invoice.findById(invoice._id)).status, 'Paid');
      await createCustomInvoice(invoiceData(customer, 100));
      assert.equal((await User.findById(customer._id)).outstandingCredit, 100);
    } finally { globalThis.fetch = oldFetch; process.env.PAYSTACK_SECRET_KEY = oldKey || ''; }
  });

  await t.test('reorder endpoint respects ownership and uses current price and stock', async () => {
    const customer = await makeVip(1000);
    const other = await makeUser({});
    const product = await Product.create({ name: 'QA Reorder', category: 'QA', price: 10, wholesalePrice: 10, stock: 10 });
    const placed = await createOrder({ customerId: customer._id, items: [{ product: product._id, quantity: 3 }], isCreditOrder: true });
    await Product.updateOne({ _id: product._id }, { $set: { wholesalePrice: 20, stock: 2 } });
    const preview = await call(getReorderPreview, { user: customer, params: { id: placed.order._id } });
    assert.equal(preview.body.data.items[0].quantity, 2);
    assert.equal(preview.body.data.items[0].cartonPrice, 20);
    assert.equal((await call(getReorderPreview, { user: other, params: { id: placed.order._id } })).statusCode, 404);
    assert.equal(await Order.countDocuments({ customer: customer._id }), 1);
  });

  await t.test('real HTTP routes enforce fresh permissions, superadmin approval and idempotent request replay', async () => {
    const app = express(); app.use(express.json());
    app.use('/api/admin', adminRoutes); app.use('/api/orders', orderRoutes); app.use('/api/invoices', invoiceRoutes); app.use(errorHandler);
    const server = await new Promise(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = async (path, user, method = 'GET', body, key = randomUUID()) => {
      const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(user ? { Authorization: `Bearer ${jwt.sign({ id: String(user._id) }, ENV.JWT_SECRET)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, body: await res.json() };
    };
    try {
      const customer = await makeVip(100);
      assert.equal((await send('/api/admin/staff', null)).status, 401);
      assert.equal((await send('/api/admin/staff', customer)).status, 403);
      assert.equal((await send('/api/admin/staff', admin)).status, 403);
      assert.equal((await send('/api/admin/staff', owner)).status, 200);
      const key = randomUUID();
      const first = await send(`/api/admin/customers/${customer._id}/credit-limit`, admin, 'POST', { creditLimit: 200, reason: 'HTTP approval test' }, key);
      assert.equal(first.status, 201);
      const replay = await send(`/api/admin/customers/${customer._id}/credit-limit`, admin, 'POST', { creditLimit: 200, reason: 'HTTP approval test' }, key);
      assert.equal(replay.status, 201);
      assert.equal(replay.body.data.request._id, first.body.data.request._id);
      const id = first.body.data.request._id;
      assert.equal((await send(`/api/admin/credit-requests/${id}/review`, admin, 'POST', { decision: 'approved' })).status, 403);
      assert.equal((await User.findById(customer._id)).creditLimit, 100);
      assert.equal((await send(`/api/admin/credit-requests/${id}/review`, owner, 'POST', { decision: 'approved' })).status, 200);
      assert.equal((await User.findById(customer._id)).creditLimit, 200);
      assert.equal((await send('/api/invoices', admin)).status, 403);
      await send(`/api/admin/staff/${admin._id}/permissions`, owner, 'PATCH', { permissions: ['invoices.view'] });
      assert.equal((await send('/api/invoices', admin)).status, 200);
      assert.equal((await send(`/api/invoices/${new mongoose.Types.ObjectId()}`, admin, 'PATCH', { status: 'Cancelled' })).status, 403);
      assert.equal((await send(`/api/admin/customers/${customer._id}/credit-limit`, admin, 'POST', { creditLimit: 300, reason: 'Revoked permission' })).status, 403);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});
