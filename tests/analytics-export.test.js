import test from 'node:test';
import assert from 'node:assert/strict';
import Visit from '../models/Visit.js';
import { getAnalyticsSummary } from '../controllers/analyticsController.js';

const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; } });

test('analytics exports retain ISO dates and Lagos calendar boundaries', async t => {
  const aggregate = Visit.aggregate;
  const distinct = Visit.distinct;
  const pipelines = [];
  Visit.aggregate = async pipeline => {
    pipelines.push(pipeline);
    const group = pipeline.find(stage => stage.$group)?.$group;
    return group?._id?.year ? [{ _id: { year: 2026, month: 10, day: 23, hour: 9 }, views: 20, visitorsCount: 2 }] : [];
  };
  Visit.distinct = async () => [];
  try {
    await t.test('custom ranges are applied on every aggregation and full dates are returned', async () => {
      const startDate = '2026-10-01T00:00:00.000+01:00';
      const endDate = '2026-10-31T23:59:59.999+01:00';
      const res = response();
      await getAnalyticsSummary({ query: { period: 'all', startDate, endDate } }, res, error => { throw error; });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data.timeline[0], { label: '10/23', date: '2026-10-23', views: 20, visitors: 2 });
      for (const pipeline of pipelines) {
        assert.equal(pipeline[0].$match.createdAt.$gte.toISOString(), '2026-09-30T23:00:00.000Z');
        assert.equal(pipeline[0].$match.createdAt.$lte.toISOString(), '2026-10-31T22:59:59.999Z');
      }
      const dateGroup = pipelines.map(pipeline => pipeline.find(stage => stage.$group)?.$group._id).find(id => id?.year);
      assert.equal(dateGroup.year.$year.timezone, 'Africa/Lagos');
      assert.equal(dateGroup.month.$month.timezone, 'Africa/Lagos');
      assert.equal(dateGroup.day.$dayOfMonth.timezone, 'Africa/Lagos');
    });
    await t.test('invalid or reversed ranges fail before database queries', async () => {
      pipelines.length = 0;
      for (const query of [{ startDate: 'invalid' }, { startDate: '2026-11-01', endDate: '2026-10-01' }]) {
        const res = response();
        await getAnalyticsSummary({ query }, res, error => { throw error; });
        assert.equal(res.statusCode, 400);
      }
      assert.equal(pipelines.length, 0);
    });
  } finally {
    Visit.aggregate = aggregate;
    Visit.distinct = distinct;
  }
});
