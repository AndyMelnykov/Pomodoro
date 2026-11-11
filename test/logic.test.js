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

// ---- Task 2: timer engine and CSV format ----
const T0 = new Date(2026, 10, 11, 14, 0).getTime(), MIN = 60000;

test('pause excludes paused time; session fields', () => {
  let s = L.startTimer(L.createTimer(45), 'Network', T0);
  assert.equal(L.activeMs(s, T0 + 10*MIN), 10*MIN);
  s = L.pauseTimer(s, T0 + 10*MIN);
  assert.equal(L.activeMs(s, T0 + 20*MIN), 10*MIN);
  s = L.resumeTimer(s, T0 + 20*MIN);
  const r = L.stopTimer(s, T0 + 50*MIN);
  assert.deepEqual(r.session, { start: '2026-11-11 14:00', finish: '2026-11-11 14:50',
    plannedMin: 45, activeMin: 40, completionPct: 89, task: 'Network' });
  assert.equal(r.state.status, 'idle'); assert.equal(r.state.task, null); assert.equal(r.state.plannedMin, 45);
});
test('overtime is uncapped', () => {
  const s = L.startTimer(L.createTimer(60), 'AI projects', T0);
  const r = L.stopTimer(s, T0 + 70*MIN);
  assert.equal(r.session.activeMin, 70); assert.equal(r.session.completionPct, 117);
});
test('stop while paused uses stop time as finish', () => {
  let s = L.startTimer(L.createTimer(45), 'Job search', T0);
  s = L.pauseTimer(s, T0 + 30*MIN);
  const r = L.stopTimer(s, T0 + 40*MIN);
  assert.equal(r.session.activeMin, 30); assert.equal(r.session.finish, '2026-11-11 14:40');
});
test('sessions under 5 rounded minutes are dropped', () => {
  const s = L.startTimer(L.createTimer(45), 'Job search', T0);
  assert.equal(L.stopTimer(s, T0 + 4*MIN + 29000).session, null);
  assert.equal(L.stopTimer(s, T0 + 4*MIN + 30000).session.activeMin, 5);
});
test('start requires a valid task and idle state', () => {
  assert.throws(() => L.startTimer(L.createTimer(), null, T0));
  assert.throws(() => L.startTimer(L.createTimer(), 'Gaming', T0));
  const s = L.startTimer(L.createTimer(), 'Network', T0);
  assert.throws(() => L.startTimer(s, 'Network', T0));
});
test('colorBand boundaries', () => {
  assert.equal(L.colorBand(45*MIN - 1, 60), 'red');
  assert.equal(L.colorBand(45*MIN, 60), 'orange');
  assert.equal(L.colorBand(54*MIN, 60), 'green');
  assert.equal(L.colorBand(60*MIN, 60), 'violet');
  assert.equal(L.colorBand(120*MIN, 60), 'violet');
});
test('ringFraction', () => {
  assert.equal(L.ringFraction(30*MIN, 60), 0.5);
  assert.equal(L.ringFraction(90*MIN, 60), 1);
});
test('setPlanned / adjustPlanned', () => {
  assert.equal(L.setPlanned(1, 30), 90);
  assert.equal(L.setPlanned('', '20'), 20);
  assert.equal(L.setPlanned(0, 0), 1);
  assert.equal(L.setPlanned(30, 99), 1439);
  assert.equal(L.adjustPlanned(45, 'm', 1), 46);
  assert.equal(L.adjustPlanned(59, 'm', 1), 60);
  assert.equal(L.adjustPlanned(1, 'm', -1), 1);
  assert.equal(L.adjustPlanned(45, 'h', 1), 105);
  assert.equal(L.adjustPlanned(1439, 'm', 1), 1439);
});
const ROW = '2026-11-11 14:00,2026-11-11 15:10,60,70,117,Interview prep (theory)';
const SESSION = { start: '2026-11-11 14:00', finish: '2026-11-11 15:10', plannedMin: 60,
  activeMin: 70, completionPct: 117, task: 'Interview prep (theory)' };
test('CSV row round trip', () => {
  assert.equal(L.CSV_HEADER, 'start,finish,planned_min,active_min,completion_pct,task');
  assert.equal(L.sessionToCsvRow(SESSION), ROW);
  assert.deepEqual(L.parseCsv(L.CSV_HEADER + '\r\n' + ROW + '\r\n\r\n'), { sessions: [SESSION], skipped: 0 });
  assert.deepEqual(L.parseCsv(''), { sessions: [], skipped: 0 });
});
test('parseCsv skips malformed rows', () => {
  const text = [L.CSV_HEADER, ROW, 'garbage', '11/11/2026 14:00,11/11/2026 15:00,60,60,100,Network',
    '2026-11-11 14:00,2026-11-11 15:00,60,x,100,Network', '2026-11-11 14:00,2026-11-11 15:00,60,60,100,Gaming'].join('\n');
  const r = L.parseCsv(text);
  assert.equal(r.sessions.length, 1); assert.equal(r.skipped, 4);
});
test('validateSession', () => {
  assert.equal(L.validateSession(SESSION), null);
  assert.notEqual(L.validateSession({ ...SESSION, task: 'Gaming' }), null);
  assert.notEqual(L.validateSession({ ...SESSION, activeMin: 'x' }), null);
  assert.notEqual(L.validateSession({ ...SESSION, start: undefined }), null);
});
test('parseCsv tolerates a UTF-8 BOM from Excel', () => {
  assert.deepEqual(L.parseCsv('﻿' + L.CSV_HEADER + '\n' + ROW + '\n'), { sessions: [SESSION], skipped: 0 });
});
