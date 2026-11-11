const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./logic.js');

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

function createServer({ root, csvPath }) {
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
  const server = createServer({ root: __dirname, csvPath: path.join(__dirname, 'sessions.csv') });
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
