const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

test('formatHM', () => {
  assert.equal(L.formatHM(0), '00:00');
  assert.equal(L.formatHM(45), '00:45');
  assert.equal(L.formatHM(125), '02:05');
  assert.equal(L.formatHM(1500), '25:00');
});
test('formatDuration', () => {
  assert.equal(L.formatDuration(0), '0m');
  assert.equal(L.formatDuration(45), '45m');
  assert.equal(L.formatDuration(95), '1h 35m');
  assert.equal(L.formatDuration(120), '2h 0m');
});
test('formatStamp and dateKey use local time', () => {
  const d = new Date(2026, 10, 11, 9, 5);
  assert.equal(L.formatStamp(d), '2026-11-11 09:05');
  assert.equal(L.dateKey(d), '2026-11-11');
});
test('addDays across DST and year end', () => {
  assert.equal(L.addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(L.addDays('2026-11-09', -7), '2026-11-02');
  assert.equal(L.addDays('2026-12-28', 7), '2027-01-04');
});
test('isWeekday', () => {
  assert.equal(L.isWeekday('2026-11-09'), true);  // Mon
  assert.equal(L.isWeekday('2026-11-13'), true);  // Fri
  assert.equal(L.isWeekday('2026-11-14'), false); // Sat
  assert.equal(L.isWeekday('2026-11-15'), false); // Sun
});
test('TASKS exact', () => {
  assert.deepEqual(L.TASKS, ['Job search', 'Network', 'AI projects', 'Interview prep (theory)']);
});
