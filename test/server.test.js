const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../logic.js');
const { createServer } = require('../server.js');

const TASK = L.TASKS[0];
const ROW = `2026-11-11 14:00,2026-11-11 15:10,60,70,117,${TASK}`;
const SESSION = { start: '2026-11-11 14:00', finish: '2026-11-11 15:10', plannedMin: 60,
  activeMin: 70, completionPct: 117, task: TASK };

let dir, csvPath, server, base;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomo-'));
  csvPath = path.join(dir, 'sessions.csv');
  server = createServer({ root: path.join(__dirname, '..'), csvPath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = (obj) => fetch(base + '/api/sessions', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj),
});

test('GET creates missing CSV with header', async () => {
  const res = await fetch(base + '/api/sessions');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), L.CSV_HEADER + '\n');
  assert.equal(fs.readFileSync(csvPath, 'utf8'), L.CSV_HEADER + '\n');
});
test('POST appends a row', async () => {
  const res = await post(SESSION);
  assert.equal(res.status, 201);
  assert.equal(fs.readFileSync(csvPath, 'utf8'), L.CSV_HEADER + '\n' + ROW + '\n');
});
test('append adds newline when file lacks one', async () => {
  fs.writeFileSync(csvPath, L.CSV_HEADER + '\n' + ROW);
  await post(SESSION);
  assert.equal(fs.readFileSync(csvPath, 'utf8'), L.CSV_HEADER + '\n' + ROW + '\n' + ROW + '\n');
});
test('invalid session returns 400 and leaves file unchanged', async () => {
  fs.writeFileSync(csvPath, L.CSV_HEADER + '\n');
  assert.equal((await post({ ...SESSION, task: 'Gaming' })).status, 400);
  assert.equal(fs.readFileSync(csvPath, 'utf8'), L.CSV_HEADER + '\n');
});
test('write failure returns 500', async () => {
  fs.mkdirSync(csvPath);                    // a directory where the file should be = unwritable
  const res = await post(SESSION);
  assert.equal(res.status, 500);
  assert.ok((await res.json()).error);
});
test('static whitelist', async () => {
  assert.equal((await fetch(base + '/logic.js')).status, 200);
  assert.equal((await fetch(base + '/tasks.js')).status, 200);
  assert.equal((await fetch(base + '/server.js')).status, 404);
  assert.equal((await fetch(base + '/sessions.csv')).status, 404);
});
