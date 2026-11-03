import test from 'node:test';
import assert from 'node:assert/strict';
import { indiaDayWindow, inquiryPeriod } from '../lib/intent/day-window';

test('new today uses India midnight with an inclusive start and exclusive next-day boundary', () => {
  assert.deepEqual(indiaDayWindow(new Date('2026-11-03T18:29:59.999Z')), {
    start: '2026-11-02T18:30:00.000Z', end: '2026-11-03T18:30:00.000Z', date: '2026-11-03', timeZone: 'Asia/Kolkata',
  });
  assert.deepEqual(indiaDayWindow(new Date('2026-11-03T18:30:00.000Z')), {
    start: '2026-11-03T18:30:00.000Z', end: '2026-11-04T18:30:00.000Z', date: '2026-11-04', timeZone: 'Asia/Kolkata',
  });
});

test('India day windows handle month, year and leap-day transitions independently of host timezone', () => {
  for (const [instant, day, start, end] of [
    ['2026-12-31T18:30:00Z', '2027-01-01', '2026-12-31T18:30:00.000Z', '2027-01-01T18:30:00.000Z'],
    ['2028-02-28T18:30:00Z', '2028-02-29', '2028-02-28T18:30:00.000Z', '2028-02-29T18:30:00.000Z'],
    ['2028-02-29T18:30:00Z', '2028-03-01', '2028-02-29T18:30:00.000Z', '2028-03-01T18:30:00.000Z'],
  ]) {
    const result = indiaDayWindow(new Date(instant));
    assert.equal(result.date, day); assert.equal(result.start, start); assert.equal(result.end, end);
    assert.equal(Date.parse(result.end) - Date.parse(result.start), 86_400_000);
  }
  assert.throws(() => indiaDayWindow(new Date('invalid')), /valid discovery date/);
});

test('today is the default and unsupported periods are rejected instead of exposing another history view', () => {
  assert.equal(inquiryPeriod(null), 'today'); assert.equal(inquiryPeriod(undefined), 'today');
  assert.equal(inquiryPeriod(''), 'today'); assert.equal(inquiryPeriod('today'), 'today');
  assert.equal(inquiryPeriod('saved'), 'saved'); assert.equal(inquiryPeriod('all'), null);
});
