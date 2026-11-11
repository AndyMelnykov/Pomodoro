const test = require('node:test');
const { afterEach } = test;
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
// Task names are never hard-coded in tests: edit tasks.js freely (fixtures use the first four entries).
const [JOB, NET, AI, PREP] = L.TASKS;
test('fixtures need at least 4 tasks in tasks.js', () => {
  assert.ok(L.TASKS.length >= 4);
});
test('TASKS and TASK_COLORS derive from TASK_DEFS', () => {
  assert.deepEqual(L.TASKS, L.TASK_DEFS.map((t) => t.db));
  for (const def of L.TASK_DEFS) assert.equal(L.TASK_COLORS[def.db], def.color);
});
test('taskLabel maps db to ui, falls back to db', () => {
  for (const def of L.TASK_DEFS) assert.equal(L.taskLabel(def.db), def.ui);
  assert.equal(L.taskLabel('Retired task'), 'Retired task');
});

// ---- Task 2: timer engine and CSV format ----
const T0 = new Date(2026, 10, 11, 14, 0).getTime(), MIN = 60000;

test('pause excludes paused time; session fields', () => {
  let s = L.startTimer(L.createTimer(45), NET, T0);
  assert.equal(L.activeMs(s, T0 + 10*MIN), 10*MIN);
  s = L.pauseTimer(s, T0 + 10*MIN);
  assert.equal(L.activeMs(s, T0 + 20*MIN), 10*MIN);
  s = L.resumeTimer(s, T0 + 20*MIN);
  const r = L.stopTimer(s, T0 + 50*MIN);
  assert.deepEqual(r.session, { start: '2026-11-11 14:00', finish: '2026-11-11 14:50',
    plannedMin: 45, activeMin: 40, completionPct: 89, task: NET });
  assert.equal(r.state.status, 'idle'); assert.equal(r.state.task, null); assert.equal(r.state.plannedMin, 45);
});
test('overtime is uncapped', () => {
  const s = L.startTimer(L.createTimer(60), AI, T0);
  const r = L.stopTimer(s, T0 + 70*MIN);
  assert.equal(r.session.activeMin, 70); assert.equal(r.session.completionPct, 117);
});
test('stop while paused uses stop time as finish', () => {
  let s = L.startTimer(L.createTimer(45), JOB, T0);
  s = L.pauseTimer(s, T0 + 30*MIN);
  const r = L.stopTimer(s, T0 + 40*MIN);
  assert.equal(r.session.activeMin, 30); assert.equal(r.session.finish, '2026-11-11 14:40');
});
test('sessions under 5 rounded minutes are dropped', () => {
  const s = L.startTimer(L.createTimer(45), JOB, T0);
  assert.equal(L.stopTimer(s, T0 + 4*MIN + 29000).session, null);
  assert.equal(L.stopTimer(s, T0 + 4*MIN + 30000).session.activeMin, 5);
});
test('start requires a valid task and idle state', () => {
  assert.throws(() => L.startTimer(L.createTimer(), null, T0));
  assert.throws(() => L.startTimer(L.createTimer(), 'Gaming', T0));
  const s = L.startTimer(L.createTimer(), NET, T0);
  assert.throws(() => L.startTimer(s, NET, T0));
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
const ROW = `2026-11-11 14:00,2026-11-11 15:10,60,70,117,${PREP}`;
const SESSION = { start: '2026-11-11 14:00', finish: '2026-11-11 15:10', plannedMin: 60,
  activeMin: 70, completionPct: 117, task: PREP };
test('CSV row round trip', () => {
  assert.equal(L.CSV_HEADER, 'start,finish,planned_min,active_min,completion_pct,task');
  assert.equal(L.sessionToCsvRow(SESSION), ROW);
  assert.deepEqual(L.parseCsv(L.CSV_HEADER + '\r\n' + ROW + '\r\n\r\n'), { sessions: [SESSION], skipped: 0 });
  assert.deepEqual(L.parseCsv(''), { sessions: [], skipped: 0 });
});
test('parseCsv skips malformed rows', () => {
  const text = [L.CSV_HEADER, ROW, 'garbage', '11/11/2026 14:00,11/11/2026 15:00,60,60,100,' + NET,
    '2026-11-11 14:00,2026-11-11 15:00,60,x,100,' + NET, '2026-11-11 14:00,2026-11-11 15:00,60,60,100,Gaming'].join('\n');
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

// ---- Task 3: dashboard calculations ----
const S = (start, task, activeMin, plannedMin) => ({ start, finish: start, task, activeMin, plannedMin,
  completionPct: Math.round(activeMin/plannedMin*100) });
const byTask = (minutes) => ({ ...Object.fromEntries(L.TASKS.map((t) => [t, 0])), ...minutes });
const WEEK = [
  S('2026-11-09 09:00', JOB, 60, 45),   // Mon
  S('2026-11-09 11:00', NET, 30, 45),      // Mon
  S('2026-11-11 10:00', NET, 45, 45),      // Wed
  S('2026-11-14 10:00', AI, 45, 60),  // Sat
];
test('summarize', () => {
  assert.deepEqual(L.summarize(WEEK), { totalMin: 180, completionPct: 92, avgPerDayMin: 60,
    avgPerWeekdayMin: 68, byTask: byTask({ [JOB]: 60, [NET]: 75, [AI]: 45 }) });
  assert.deepEqual(L.summarize([]), { totalMin: 0, completionPct: null, avgPerDayMin: null,
    avgPerWeekdayMin: null, byTask: byTask({}) });
});
test('dailyByTask zero-fills every day', () => {
  const r = L.dailyByTask(WEEK, '2026-11-09', '2026-11-15');
  assert.equal(r.days.length, 7);
  assert.deepEqual(r.series[NET], [30, 0, 45, 0, 0, 0, 0]);
  assert.deepEqual(r.series[AI], [0, 0, 0, 0, 0, 45, 0]);
});
test('session crossing midnight counts on start day', () => {
  const s = { ...S('2026-11-11 23:30', NET, 60, 45), finish: '2026-11-12 00:30' };
  assert.equal(L.filterByRange([s], '2026-11-12', '2026-11-12').length, 0);
  assert.deepEqual(L.dailyByTask([s], '2026-11-11', '2026-11-12').series[NET], [60, 0]);
});
test('weekRange Mon-Sun', () => {
  const want = { from: '2026-11-09', to: '2026-11-15' };
  assert.deepEqual(L.weekRange(new Date(2026, 10, 9)), want);   // Mon
  assert.deepEqual(L.weekRange(new Date(2026, 10, 11)), want);  // Wed
  assert.deepEqual(L.weekRange(new Date(2026, 10, 15)), want);  // Sun
});
test('shiftRange and canGoForward', () => {
  assert.deepEqual(L.shiftRange({ from: '2026-11-09', to: '2026-11-15' }, -7), { from: '2026-11-02', to: '2026-11-08' });
  assert.equal(L.canGoForward('2026-11-15', '2026-11-11'), false);
  assert.equal(L.canGoForward('2026-11-11', '2026-11-11'), false);
  assert.equal(L.canGoForward('2026-11-08', '2026-11-11'), true);
});

// ---- runtime task list ----
const DEFAULTS = JSON.parse(JSON.stringify(L.TASK_DEFS));
afterEach(() => L.setTasks(DEFAULTS));
const D = (db, extra = {}) => ({ ui: db.toUpperCase(), db, color: '#112233', ...extra });

test('setTasks swaps live getters', () => {
  L.setTasks([{ ui: 'X', db: 'x', color: '#000000' }]);
  assert.deepEqual(L.TASKS, ['x']);
  assert.equal(L.TASK_COLORS.x, '#000000');
  assert.equal(L.taskLabel('x'), 'X');
});
test('setTasks rejects invalid list', () => {
  assert.throws(() => L.setTasks([]));
  assert.throws(() => L.setTasks([D('a'), D('a')]));
});
test('ACTIVE_TASK_DEFS excludes archived', () => {
  L.setTasks([D('a'), D('b', { archived: true })]);
  assert.deepEqual(L.ACTIVE_TASK_DEFS.map((t) => t.db), ['a']);
  assert.deepEqual(L.TASK_DEFS.map((t) => t.db), ['a', 'b']);
  assert.deepEqual(L.TASKS, ['a', 'b']);
});
test('archived type is not startable but still valid in sessions', () => {
  L.setTasks([D('a'), D('b', { archived: true })]);
  assert.throws(() => L.startTimer(L.createTimer(45), 'b', 0), /Unknown task/);
  assert.doesNotThrow(() => L.startTimer(L.createTimer(45), 'a', 0));
  const sess = { start: '2026-11-11 14:00', finish: '2026-11-11 15:00', plannedMin: 60, activeMin: 60, completionPct: 100, task: 'b' };
  assert.equal(L.validateSession(sess), null);
  assert.equal(L.summarize([sess]).byTask.b, 60);
});
test('applyTaskEdits: archive, delete, move, reorder, add', () => {
  const original = [D('a'), D('b'), D('c'), D('d'), D('old', { archived: true })];
  const draft = [D('d'), D('a', { color: '#abcdef' }), D('new')];
  const r = L.applyTaskEdits(original, draft, { b: 'archive', c: { moveTo: 'a' } });
  assert.deepEqual(r.tasks.map((t) => t.db), ['d', 'a', 'new', 'old', 'b']);
  assert.deepEqual(r.tasks.filter((t) => t.archived).map((t) => t.db), ['old', 'b']);
  assert.equal(r.tasks.find((t) => t.db === 'b').ui, 'B');
  assert.equal(r.tasks.find((t) => t.db === 'a').color, '#abcdef');
  assert.deepEqual(r.remap, { c: 'a' });
  const r2 = L.applyTaskEdits([D('a'), D('b')], [D('a')], { b: 'delete' });
  assert.deepEqual(r2.tasks.map((t) => t.db), ['a']);
  assert.deepEqual(r2.remap, {});
});
test('applyTaskEdits throws without a decision for a removed type', () => {
  assert.throws(() => L.applyTaskEdits([D('a'), D('b')], [D('a')], {}));
});
test('remapTaskInCsv rewrites only matching rows and preserves CRLF', () => {
  const row = (t) => 'S,F,60,60,100,' + t;
  const text = [L.CSV_HEADER, row('a'), row('ab'), row('b')].join('\r\n') + '\r\n';
  assert.equal(L.remapTaskInCsv(text, 'a', 'b'),
    [L.CSV_HEADER, row('b'), row('ab'), row('b')].join('\r\n') + '\r\n');
  assert.equal(L.remapTaskInCsv(row('a'), 'a', 'b'), row('b'));
  assert.equal(L.remapTaskInCsv(L.CSV_HEADER + '\n', 'task', 'x'), L.CSV_HEADER + '\n');
});

const DEFS4 = [
  { ui: 'A', db: 'a', color: '#000001' },
  { ui: 'B', db: 'b', color: '#000002' },
  { ui: 'Old1', db: 'o1', color: '#000003', archived: true },
  { ui: 'Old2', db: 'o2', color: '#000004', archived: true },
];
test('shownTypes: active types always, in button order', () => {
  L.setTasks(DEFS4);
  assert.deepEqual(L.shownTypes({ a: 0, b: 0, o1: 0, o2: 0 }), ['a', 'b']);
  assert.deepEqual(L.shownTypes({}), ['a', 'b']);
});
test('shownTypes: archived types only when they have minutes', () => {
  L.setTasks(DEFS4);
  assert.deepEqual(L.shownTypes({ a: 0, b: 5, o1: 0, o2: 30 }), ['a', 'b', 'o2']);
  assert.deepEqual(L.shownTypes({ o1: 1, o2: 1 }), ['a', 'b', 'o1', 'o2']);
});
test('shownTypes: accepts per-day arrays (dailyByTask series)', () => {
  L.setTasks(DEFS4);
  assert.deepEqual(L.shownTypes({ a: [0, 0], b: [0, 0], o1: [0, 15], o2: [0, 0] }), ['a', 'b', 'o1']);
});
test('dayLabel: ddd D MMM', () => {
  assert.equal(L.dayLabel('2026-11-09'), 'Mon 9 Nov');
  assert.equal(L.dayLabel('2026-11-15'), 'Sun 15 Nov');
  assert.equal(L.dayLabel('2027-01-01'), 'Fri 1 Jan');
});
