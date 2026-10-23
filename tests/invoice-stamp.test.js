import test from 'node:test';
import assert from 'node:assert/strict';
import Invoice from '../models/Invoice.js';
import { getInvoiceDownloadData } from '../controllers/invoiceController.js';

const makeInvoice = (overrides = {}) => ({
  _id: 'invoice-1', invoiceNumber: 'INV-001', status: 'Paid',
  customer: { _id: 'customer-1', firstName: 'Test', lastName: 'Buyer', profile: {} },
  createdBy: { firstName: 'Invoice', lastName: 'Creator', role: 'admin' },
  issuedBy: '', items: [], subtotal: 5000, total: 5000,
  ...overrides,
});

const response = () => ({
  statusCode: 200,
  status(value) { this.statusCode = value; return this; },
  json(body) { this.body = body; return this; },
});

test('invoice download stamp approval', async t => {
  const originalFind = Invoice.findById;
  let storedInvoice;
  Invoice.findById = () => ({
    populate() { return this; },
    then(resolve, reject) { return Promise.resolve(storedInvoice).then(resolve, reject); },
  });
  const download = async (role = 'customer', userId = 'customer-1') => {
    const res = response();
    await getInvoiceDownloadData({ params: { id: 'invoice-1' }, user: { role, _id: userId } }, res, error => { throw error; });
    return res;
  };

  try {
    await t.test('paid invoice with a creator is still blocked without an explicit stamp', async () => {
      storedInvoice = makeInvoice();
      const res = await download();
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error.code, 'INVOICE_NOT_STAMPED');
      assert.equal(res.body.data, undefined);
    });
    await t.test('whitespace does not count as a stamp', async () => {
      storedInvoice = makeInvoice({ issuedBy: '   ' });
      assert.equal((await download()).statusCode, 403);
    });
    await t.test('fresh retry succeeds after an admin stamp is saved', async () => {
      storedInvoice = makeInvoice();
      assert.equal((await download()).statusCode, 403);
      storedInvoice.issuedBy = 'Approving Admin';
      const res = await download();
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.issuedBy, 'Approving Admin');
    });
    await t.test('a pending stamped invoice can be downloaded independently of payment status', async () => {
      storedInvoice = makeInvoice({ issuedBy: 'Approving Admin', status: 'Pending' });
      assert.equal((await download()).statusCode, 200);
    });
    await t.test('another customer cannot download even a stamped invoice', async () => {
      storedInvoice = makeInvoice({ issuedBy: 'Approving Admin' });
      const res = await download('customer', 'other-customer');
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.message, 'Access denied');
    });
    await t.test('admin can still export an unstamped invoice for review', async () => {
      storedInvoice = makeInvoice();
      const res = await download('admin');
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.issuedBy, null);
    });
    await t.test('unknown invoice returns not found', async () => {
      storedInvoice = null;
      assert.equal((await download()).statusCode, 404);
    });
  } finally {
    Invoice.findById = originalFind;
  }
});
