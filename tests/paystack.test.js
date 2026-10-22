import test from 'node:test';
import assert from 'node:assert/strict';
import Payment from '../models/Payment.js';
import { settlePayment, paystackWebhook } from '../routes/paymentRoutes.js';

test('unsigned webhook is rejected before processing', async () => {
  let status;
  await paystackWebhook({ get: () => '', body: Buffer.from('{}') }, { sendStatus: value => { status = value; } }, error => { throw error; });
  assert.equal(status, 401);
});

test('verification rejects mismatched payment amount', async () => {
  const originalFind = Payment.findOne;
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.PAYSTACK_SECRET_KEY;
  try {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_mock';
    Payment.findOne = async () => ({ reference: 'test-reference', amount: 50000, currency: 'NGN' });
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: true, data: { reference: 'test-reference', status: 'success', amount: 1, currency: 'NGN' } }) });
    await assert.rejects(settlePayment('test-reference'), /does not match/);
  } finally {
    Payment.findOne = originalFind;
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = originalSecret;
  }
});

test('pending payment does not settle invoices or orders', async () => {
  const originalFind = Payment.findOne;
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.PAYSTACK_SECRET_KEY;
  try {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_mock';
    Payment.findOne = async () => ({ reference: 'pending-reference' });
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: true, data: { status: 'pending' } }) });
    assert.deepEqual(await settlePayment('pending-reference'), { status: 'pending', reference: 'pending-reference' });
  } finally {
    Payment.findOne = originalFind;
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = originalSecret;
  }
});
