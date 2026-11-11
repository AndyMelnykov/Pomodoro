const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./logic.js');
const Tasks = require('./tasks.js');

const HOST = '127.0.0.1';
const PORT = 8765;
const MAX_BODY = 10 * 1024;

// Only these URL paths are ever served from disk.
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/logic.js': ['logic.js', 'application/javascript; charset=utf-8'],
  '/tasks.js': ['tasks.js', 'application/javascript; charset=utf-8'],
  '/chart.umd.js': ['chart.umd.js', 'application/javascript; charset=utf-8'],
};

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const sendJson = (res, status, obj) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj));

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function ensureCsv(csvPath) {
  if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, L.CSV_HEADER + '\n');
}

function appendSession(csvPath, session) {
  ensureCsv(csvPath);
  const existing = fs.readFileSync(csvPath, 'utf8');
  const prefix = existing === '' || existing.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(csvPath, prefix + L.sessionToCsvRow(session) + '\n');
}

function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// A missing or invalid tasks.json means the built-in defaults; the file itself is never touched here.
function loadTasks(tasksPath) {
  let defs = Tasks.DEFAULT_TASK_DEFS;
  try {
    const loaded = JSON.parse(fs.readFileSync(tasksPath, 'utf8')).tasks;
    if (Tasks.validateTaskDefs(loaded) === null) defs = loaded;
  } catch { /* use defaults */ }
  L.setTasks(defs);
}

// Returns an error message, or null when `body` may be saved over the current list.
function checkTaskSave(body, csvText) {
  if (!body || typeof body !== 'object') return 'Body must be an object';
  const problem = Tasks.validateTaskDefs(body.tasks);
  if (problem) return problem;
  const remap = body.remap === undefined ? {} : body.remap;
  if (!remap || typeof remap !== 'object' || Array.isArray(remap)) return 'remap must be an object';
  const kept = new Set(body.tasks.map((t) => t.db));
  const active = new Set(body.tasks.filter((t) => !t.archived).map((t) => t.db));
  for (const [from, to] of Object.entries(remap)) {
    if (kept.has(from)) return 'Cannot move sessions away from a type that stays: ' + from;
    if (typeof to !== 'string' || !active.has(to)) return 'Cannot move sessions to "' + to + '": it must be an active task type';
  }
  const counts = {};
  for (const s of L.parseCsv(csvText).sessions) counts[s.task] = (counts[s.task] || 0) + 1;
  for (const t of L.TASK_DEFS) {
    if (!kept.has(t.db) && counts[t.db] > 0 && !Object.hasOwn(remap, t.db)) {
      return '"' + t.db + '" has ' + counts[t.db] + ' recorded sessions: archive it or move them to another type';
    }
  }
  return null;
}

function createServer({ root, csvPath, tasksPath }) {
  if (tasksPath) loadTasks(tasksPath); else L.setTasks(Tasks.DEFAULT_TASK_DEFS);
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/sessions') {
        if (req.method === 'GET') {
          try {
            ensureCsv(csvPath);
            return send(res, 200, 'text/csv; charset=utf-8', fs.readFileSync(csvPath));
          } catch (e) {
            return sendJson(res, 500, { error: 'Could not read sessions.csv: ' + e.message });
          }
        }
        if (req.method === 'POST') {
          let session;
          try {
            session = JSON.parse(await readBody(req));
          } catch (e) {
            return sendJson(res, 400, { error: e.message === 'Request body too large' ? e.message : 'Invalid JSON' });
          }
          const problem = L.validateSession(session);
          if (problem) return sendJson(res, 400, { error: problem });
          try {
            appendSession(csvPath, session);
          } catch (e) {
            return sendJson(res, 500, { error: 'Could not write sessions.csv: ' + e.message });
          }
          return sendJson(res, 201, { ok: true });
        }
        return sendJson(res, 405, { error: 'Method not allowed' });
      }

      if (url.pathname === '/api/tasks') {
        if (req.method === 'GET') return sendJson(res, 200, { tasks: L.TASK_DEFS });
        if (req.method === 'PUT') {
          let body;
          try {
            body = JSON.parse(await readBody(req));
          } catch (e) {
            return sendJson(res, 400, { error: e.message === 'Request body too large' ? e.message : 'Invalid JSON' });
          }
          let csvText;
          try {
            ensureCsv(csvPath);
            csvText = fs.readFileSync(csvPath, 'utf8');
          } catch (e) {
            return sendJson(res, 500, { error: 'Could not read sessions.csv: ' + e.message });
          }
          const problem = checkTaskSave(body, csvText);
          if (problem) return sendJson(res, 400, { error: problem });
          try {
            let newCsv = csvText;
            for (const [from, to] of Object.entries(body.remap || {})) newCsv = L.remapTaskInCsv(newCsv, from, to);
            if (newCsv !== csvText) atomicWrite(csvPath, newCsv);
            if (tasksPath) atomicWrite(tasksPath, JSON.stringify({ tasks: body.tasks }, null, 2) + '\n');
          } catch (e) {
            return sendJson(res, 500, { error: 'Could not save: ' + e.message });
          }
          L.setTasks(body.tasks);
          return sendJson(res, 200, { ok: true });
        }
        return sendJson(res, 405, { error: 'Method not allowed' });
      }

      const entry = req.method === 'GET' && Object.hasOwn(STATIC, url.pathname) ? STATIC[url.pathname] : null;
      if (!entry) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
      let body;
      try { body = fs.readFileSync(path.join(root, entry[0])); }
      catch { return send(res, 404, 'text/plain; charset=utf-8', 'Not found'); }
      return send(res, 200, entry[1], body);
    } catch (e) {
      if (!res.headersSent) return sendJson(res, 500, { error: e.message });
      res.end();
    }
  });
}

if (require.main === module) {
  const server = createServer({ root: __dirname, csvPath: path.join(__dirname, 'sessions.csv'), tasksPath: path.join(__dirname, 'tasks.json') });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.log(`Already running at http://${HOST}:${PORT}/`);
      process.exit(0);
    }
    throw e;
  });
  server.listen(PORT, HOST, () => console.log(`Pomodoro running at http://${HOST}:${PORT}/`));
}

module.exports = { createServer };
