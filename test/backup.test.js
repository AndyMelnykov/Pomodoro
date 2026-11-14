const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { backupData, countRows, stamp, ROLLING_KEEP } = require('../backup.js');

const HEADER = 'start,finish,planned_min,active_min,completion_pct,task';
const row = (i) => `2026-11-${String(i).padStart(2, '0')} 10:00,2026-11-${String(i).padStart(2, '0')} 10:30,30,30,100,Study`;
const csvWith = (n) => [HEADER, ...Array.from({ length: n }, (_, i) => row(i + 1))].join('\n') + '\n';

let dir, backupDir, csvPath, tasksPath;
const at = (iso) => new Date(iso);
const run = (iso) => backupData({ backupDir, csvPath, tasksPath, now: at(iso) });
const list = () => fs.readdirSync(backupDir).sort();
const rolling = () => list().filter((n) => !n.startsWith('weekly_'));
const weekly = () => list().filter((n) => n.startsWith('weekly_'));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomo-bak-'));
  backupDir = path.join(dir, 'backups');
  csvPath = path.join(dir, 'sessions.csv');
  tasksPath = path.join(dir, 'tasks.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('countRows ignores the header and blank lines, handles CRLF', () => {
  assert.equal(countRows(''), 0);
  assert.equal(countRows(HEADER + '\n'), 0);
  assert.equal(countRows(csvWith(3).replace(/\n/g, '\r\n') + '\r\n'), 3);
});

test('no sessions.csv: nothing is created', () => {
  const r = run('2026-11-14T10:00:00');
  assert.deepEqual(r, { created: [], deleted: [], warning: null });
  assert.equal(fs.existsSync(backupDir), false);
});

test('first start makes a rolling and a weekly snapshot with both files', () => {
  fs.writeFileSync(csvPath, csvWith(2));
  fs.writeFileSync(tasksPath, '{"tasks":[]}\n');
  const r = run('2026-11-14T10:00:00');
  const name = stamp(at('2026-11-14T10:00:00'));
  assert.deepEqual(r.created, [name, 'weekly_' + name]);
  assert.equal(r.warning, null);
  for (const n of [name, 'weekly_' + name]) {
    assert.equal(fs.readFileSync(path.join(backupDir, n, 'sessions.csv'), 'utf8'), csvWith(2));
    assert.equal(fs.readFileSync(path.join(backupDir, n, 'tasks.json'), 'utf8'), '{"tasks":[]}\n');
  }
});

test('works without tasks.json', () => {
  fs.writeFileSync(csvPath, csvWith(1));
  run('2026-11-14T10:00:00');
  assert.deepEqual(fs.readdirSync(path.join(backupDir, rolling()[0])), ['sessions.csv']);
});

test(`keeps only the newest ${ROLLING_KEEP} rolling snapshots`, () => {
  for (let i = 1; i <= 5; i++) {
    fs.writeFileSync(csvPath, csvWith(i));
    run(`2026-11-14T1${i}:00:00`);
  }
  assert.deepEqual(rolling(), ['2026-11-14_13-00-00', '2026-11-14_14-00-00', '2026-11-14_15-00-00']);
  assert.equal(fs.readFileSync(path.join(backupDir, '2026-11-14_15-00-00', 'sessions.csv'), 'utf8'), csvWith(5));
});

test('restart with unchanged data does not push out older snapshots', () => {
  fs.writeFileSync(csvPath, csvWith(1));
  run('2026-11-14T10:00:00');
  fs.writeFileSync(csvPath, csvWith(2));
  run('2026-11-14T11:00:00');
  for (let h = 12; h <= 16; h++) assert.deepEqual(run(`2026-11-14T${h}:00:00`).created, []);
  assert.deepEqual(rolling(), ['2026-11-14_10-00-00', '2026-11-14_11-00-00']);
});

test('a tasks.json change alone makes a new rolling snapshot', () => {
  fs.writeFileSync(csvPath, csvWith(1));
  fs.writeFileSync(tasksPath, '{"tasks":[1]}');
  run('2026-11-14T10:00:00');
  fs.writeFileSync(tasksPath, '{"tasks":[2]}');
  assert.deepEqual(run('2026-11-14T11:00:00').created, ['2026-11-14_11-00-00']);
});

test('weekly snapshot is replaced only once it is a week old', () => {
  fs.writeFileSync(csvPath, csvWith(1));
  run('2026-11-01T10:00:00');
  fs.writeFileSync(csvPath, csvWith(2));
  run('2026-11-08T09:59:59');
  assert.deepEqual(weekly(), ['weekly_2026-11-01_10-00-00']);
  fs.writeFileSync(csvPath, csvWith(3));
  const r = run('2026-11-08T10:00:00');
  assert.deepEqual(weekly(), ['weekly_2026-11-08_10-00-00']);
  assert.ok(r.deleted.includes('weekly_2026-11-01_10-00-00'));
});

test('fewer rows than the newest backup: warning, nothing created or deleted', () => {
  fs.writeFileSync(csvPath, csvWith(5));
  run('2026-11-14T10:00:00');
  const before = list();
  fs.writeFileSync(csvPath, csvWith(1)); // e.g. an update copied an old file over it
  const r = run('2026-11-14T11:00:00');
  assert.deepEqual(r.created, []);
  assert.deepEqual(r.deleted, []);
  assert.match(r.warning, /has 1 sessions, but the latest backup \(backups\/2026-11-14_10-00-00\) has 5/);
  assert.deepEqual(list(), before);
});

test('an empty file after an overwrite is caught too', () => {
  fs.writeFileSync(csvPath, csvWith(3));
  run('2026-11-14T10:00:00');
  fs.writeFileSync(csvPath, '');
  assert.ok(run('2026-11-14T11:00:00').warning);
});

test('a leftover .tmp folder is ignored and replaced', () => {
  fs.mkdirSync(path.join(backupDir, '2026-11-14_10-00-00.tmp'), { recursive: true });
  fs.writeFileSync(csvPath, csvWith(1));
  run('2026-11-14T10:00:00');
  assert.deepEqual(list(), ['2026-11-14_10-00-00', 'weekly_2026-11-14_10-00-00']);
});
