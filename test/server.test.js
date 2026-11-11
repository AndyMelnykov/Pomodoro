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
  assert.equal((await fetch(base + '/tasks.json')).status, 404);
});

// ---- /api/tasks ----
const DEFAULTS = JSON.parse(JSON.stringify(L.TASK_DEFS));
afterEach(() => L.setTasks(DEFAULTS));

const D = (db, extra = {}) => ({ ui: db.toUpperCase(), db, color: '#112233', ...extra });
const putTasks = (b, body) => fetch(b + '/api/tasks', {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const getTasks = async (b) => (await (await fetch(b + '/api/tasks')).json()).tasks;
const csvRow = (task) => `2026-11-11 14:00,2026-11-11 15:00,60,60,100,${task}`;

// a second server with its own tasks.json inside the test's temp dir
async function startWithTasks(csvText) {
  const tasksPath = path.join(dir, 'tasks.json');
  if (csvText !== undefined) fs.writeFileSync(csvPath, csvText);
  const s = createServer({ root: path.join(__dirname, '..'), csvPath, tasksPath });
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  return { s, tasksPath, b: 'http://127.0.0.1:' + s.address().port,
    close: () => new Promise((resolve) => s.close(resolve)) };
}

test('GET /api/tasks returns defaults when there is no file', async () => {
  const t = await startWithTasks();
  try {
    assert.deepEqual(await getTasks(t.b), DEFAULTS);
    assert.equal(fs.existsSync(t.tasksPath), false);
  } finally { await t.close(); }
});
test('PUT saves, GET returns it, file exists, a new server loads it', async () => {
  const t = await startWithTasks();
  const list = [D('b'), D('a')];
  try {
    const res = await putTasks(t.b, { tasks: list });
    assert.equal(res.status, 200);
    assert.deepEqual(await getTasks(t.b), list);
    assert.deepEqual(JSON.parse(fs.readFileSync(t.tasksPath, 'utf8')).tasks, list);
  } finally { await t.close(); }
  L.setTasks(DEFAULTS);
  const t2 = await startWithTasks();
  try { assert.deepEqual(await getTasks(t2.b), list); } finally { await t2.close(); }
});
test('PUT rejects an invalid list and leaves the file unchanged', async () => {
  const t = await startWithTasks();
  try {
    const res = await putTasks(t.b, { tasks: [D('a'), D('a')] });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);
    assert.equal(fs.existsSync(t.tasksPath), false);
    assert.deepEqual(await getTasks(t.b), DEFAULTS);
  } finally { await t.close(); }
});
test('PUT rejects removing a type with sessions and no remap', async () => {
  const csv = L.CSV_HEADER + '\n' + csvRow('b') + '\n';
  const t = await startWithTasks(csv);
  try {
    assert.equal((await putTasks(t.b, { tasks: [D('a'), D('b')] })).status, 200);
    const res = await putTasks(t.b, { tasks: [D('a')] });
    assert.equal(res.status, 400);
    assert.equal(fs.readFileSync(csvPath, 'utf8'), csv);
    assert.deepEqual((await getTasks(t.b)).map((x) => x.db), ['a', 'b']);
  } finally { await t.close(); }
});
test('PUT with remap rewrites CSV rows and removes the type', async () => {
  const t = await startWithTasks(L.CSV_HEADER + '\r\n' + csvRow('b') + '\r\n' + csvRow('a') + '\r\n');
  try {
    await putTasks(t.b, { tasks: [D('a'), D('b')] });
    const res = await putTasks(t.b, { tasks: [D('a')], remap: { b: 'a' } });
    assert.equal(res.status, 200);
    assert.equal(fs.readFileSync(csvPath, 'utf8'), L.CSV_HEADER + '\r\n' + csvRow('a') + '\r\n' + csvRow('a') + '\r\n');
    assert.deepEqual((await getTasks(t.b)).map((x) => x.db), ['a']);
  } finally { await t.close(); }
});
test('PUT rejects a remap to the same, a missing or an archived type', async () => {
  const csv = L.CSV_HEADER + '\n' + csvRow('b') + '\n';
  const t = await startWithTasks(csv);
  try {
    await putTasks(t.b, { tasks: [D('a'), D('b'), D('c', { archived: true })] });
    for (const [tasks, remap] of [
      [[D('a'), D('c', { archived: true })], { b: 'c' }],   // archived target
      [[D('a')], { b: 'zzz' }],                             // missing target
      [[D('a'), D('b')], { b: 'b' }],                       // same type, still present
    ]) {
      assert.equal((await putTasks(t.b, { tasks, remap })).status, 400);
    }
    assert.equal(fs.readFileSync(csvPath, 'utf8'), csv);
  } finally { await t.close(); }
});
test('PUT allows removing a type with no sessions', async () => {
  const t = await startWithTasks();
  try {
    await putTasks(t.b, { tasks: [D('a'), D('b')] });
    assert.equal((await putTasks(t.b, { tasks: [D('a')] })).status, 200);
  } finally { await t.close(); }
});
test('archived type: old rows still parse and a new session still validates', async () => {
  const csv = L.CSV_HEADER + '\n' + csvRow('b') + '\n';
  const t = await startWithTasks(csv);
  try {
    assert.equal((await putTasks(t.b, { tasks: [D('a'), D('b', { archived: true })] })).status, 200);
    assert.equal(L.parseCsv(await (await fetch(t.b + '/api/sessions')).text()).sessions.length, 1);
    const res = await fetch(t.b + '/api/sessions', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...SESSION, task: 'b' }) });
    assert.equal(res.status, 201);
  } finally { await t.close(); }
});
test('corrupt tasks.json at startup: defaults used, file untouched', async () => {
  fs.writeFileSync(path.join(dir, 'tasks.json'), '{ not json');
  const t = await startWithTasks();
  try {
    assert.deepEqual(await getTasks(t.b), DEFAULTS);
    assert.equal(fs.readFileSync(t.tasksPath, 'utf8'), '{ not json');
  } finally { await t.close(); }
});
