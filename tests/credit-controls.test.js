import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCreditLimit, assertCreditExposure } from '../utils/creditPolicy.js';
import { hasPermission, requiredPermissions } from '../utils/staffPermissions.js';
import { prepareReorder } from '../services/reorderService.js';

test('credit limits validate zero, cents and reject invalid/unsafe amounts', () => {
  assert.equal(parseCreditLimit(0), 0);
  assert.equal(parseCreditLimit('250000.25'), 250000.25);
  for (const value of [-1, Infinity, NaN, '', null, true, {}, 'abc', 1.001, Number.MAX_SAFE_INTEGER]) assert.throws(() => parseCreditLimit(value));
});

test('only additional debt requires available approved VIP credit', () => {
  const customer = { role: 'customer', isVipCreditPartner: true, creditLimit: 500, accountStatus: 'active' };
  assert.doesNotThrow(() => assertCreditExposure(customer, 300, 500));
  assert.throws(() => assertCreditExposure(customer, 300, 500.01), /exceeded/);
  assert.throws(() => assertCreditExposure({ ...customer, creditLimit: 0 }, 0, 1), /exceeded/);
  assert.throws(() => assertCreditExposure({ ...customer, isVipCreditPartner: false }, 0, 1), /VIP/);
  assert.doesNotThrow(() => assertCreditExposure({ ...customer, isVipCreditPartner: false, creditLimit: 0 }, 300, 100));
  assert.doesNotThrow(() => assertCreditExposure({ ...customer, creditLimit: 0 }, 300, 300));
});

test('permissions deny ordinary admins by default, cover aliases and distinguish stock from prices', () => {
  assert.equal(hasPermission({ role: 'admin' }, 'settings.manage'), false);
  assert.equal(hasPermission({ role: 'customer', staffPermissions: ['settings.manage'] }, 'settings.manage'), false);
  assert.equal(hasPermission({ role: 'superadmin' }, 'settings.manage'), true);
  const warehouse = { role: 'admin', staffPermissions: ['inventory.manage'] };
  assert.equal(hasPermission(warehouse, 'catalog.read'), true);
  assert.equal(hasPermission(warehouse, 'products.manage'), false);
  for (const path of ['/api/orders/123/status', '/api/admin/orders/123/status']) assert.deepEqual(requiredPermissions('PATCH', path), ['orders.manage']);
  assert.deepEqual(requiredPermissions('PATCH', '/api/products/123', { stock: 10 }), ['inventory.manage']);
  assert.deepEqual(requiredPermissions('PATCH', '/api/products/123', { stock: 10, wholesalePrice: 1 }), ['products.manage', 'inventory.manage']);
  assert.deepEqual(requiredPermissions('GET', '/api/settings/sessions'), []);
  assert.deepEqual(requiredPermissions('POST', '/api/admin/customers/123/credit-limit'), ['credit.request']);
});

test('reorder uses current prices, groups repeated lines and caps cartons/units independently', () => {
  const product = { _id: 'p1', name: 'Soap', status: 'active', wholesalePrice: 2400, minimumQuantity: 12, stock: 3, unitStock: 5 };
  const result = prepareReorder({ items: [{ product: 'p1', quantity: 2 }, { product: 'p1', quantity: 3 }, { product: 'p1', quantity: 2, isCarton: false }] }, [product]);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].quantity, 3);
  assert.equal(result.items[0].cartonPrice, 2400);
  assert.equal(result.items[1].unitPrice, 200);
  assert.equal(result.items[1].quantity, 2);
  assert.equal(result.notices.length, 1);
  assert.equal(prepareReorder({ items: [{ product: 'p1', quantity: 1 }] }, [{ ...product, status: 'inactive' }]).items.length, 0);
  assert.equal(prepareReorder({ items: [{ product: 'p1', quantity: 1, isCarton: false }] }, [{ ...product, allowPieces: false }]).items.length, 0);
});
