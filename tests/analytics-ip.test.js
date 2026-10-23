import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVisitorIp } from '../utils/visitorIdentity.js';
import Visit from '../models/Visit.js';
import { trackVisit } from '../controllers/analyticsController.js';

test('IPv4-mapped IPv6 addresses identify the same IP', () => {
  assert.equal(normalizeVisitorIp('::ffff:192.0.2.10'), normalizeVisitorIp('192.0.2.10'));
});
test('IPv6 spelling variants identify the same IP', () => {
  assert.equal(normalizeVisitorIp('2001:0DB8:0000:0000:0000:0000:0000:1'), normalizeVisitorIp('2001:db8::1'));
});
test('invalid forwarded address lists are not treated as a single device IP', () => {
  assert.equal(normalizeVisitorIp('192.0.2.1, 192.0.2.2'), '');
  assert.equal(normalizeVisitorIp('unknown'), '');
});

test('repeat tracking increments views atomically and uses the server-resolved IP', async () => {
  const originalFind = Visit.findOne;
  const originalUpdate = Visit.findByIdAndUpdate;
  const queries = [];
  let update;
  Visit.findOne = query => {
    queries.push(query);
    return Promise.resolve({ _id: 'session-1', visitorId: 'browser-1', pageViewsCount: 19 });
  };
  Visit.findByIdAndUpdate = async (id, changes) => {
    update = changes;
    assert.equal(id, 'session-1');
    return { pageViewsCount: 20 };
  };
  let result;
  const res = { status() { return this; }, json(body) { result = body; return this; } };
  try {
    await trackVisit({ ip: '::ffff:192.0.2.10', headers: { 'x-forwarded-for': '198.51.100.99' }, body: { visitorId: 'browser-1', sessionId: 'session-1', path: '/shop' } }, res);
    assert.equal(queries[0].ip, '192.0.2.10');
    assert.equal(update.$inc.pageViewsCount, 1);
    assert.equal(update.$push.pagesVisited.path, '/shop');
    assert.equal(result.data.pageViewsCount, 20);
  } finally {
    Visit.findOne = originalFind;
    Visit.findByIdAndUpdate = originalUpdate;
  }
});
