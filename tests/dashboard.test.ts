import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardPeriod } from '../lib/dashboard';

test('dashboard reporting period accepts only supported values', () => {
  assert.equal(dashboardPeriod('all'), 'all');
  assert.equal(dashboardPeriod('week'), 'week');
  assert.equal(dashboardPeriod('month'), 'month');
  for (const value of [undefined, null, '', ['all'], 'year', 'month;drop table leads']) {
    assert.equal(dashboardPeriod(value), 'month');
  }
});
