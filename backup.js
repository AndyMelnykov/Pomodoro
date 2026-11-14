// Snapshots of the data files, taken once when the server starts.
//
// backups/
//   2026-11-14_09-30-12/   rolling: the newest ROLLING_KEEP snapshots are kept
//   weekly_2026-11-10_08-00-03/   weekly: one snapshot, replaced when it is a week old
//
// Each snapshot holds sessions.csv and tasks.json (whichever exist).
//
// Guard: sessions.csv only ever grows (sessions are appended; renames and moves rewrite rows
// but never drop them). If it has fewer rows than the newest snapshot, it was probably
// overwritten, so nothing is backed up or deleted and a warning is returned instead.
const fs = require('node:fs');
const path = require('node:path');

const ROLLING_KEEP = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STAMP = String.raw`\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}`;
const ROLLING_RE = new RegExp('^' + STAMP + '$');
const WEEKLY_RE = new RegExp('^weekly_(' + STAMP + ')$');

const pad = (n) => String(n).padStart(2, '0');
function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
function parseStamp(s) {
  const [y, mo, d, h, mi, se] = s.split(/[-_]/).map(Number);
  return new Date(y, mo - 1, d, h, mi, se);
}

// Rows after the header, ignoring blank lines.
function countRows(text) {
  return Math.max(0, text.split(/\r?\n/).filter((l) => l.trim() !== '').length - 1);
}

const readOrNull = (file) => (fs.existsSync(file) ? fs.readFileSync(file) : null);
const sameBytes = (a, b) => (a === null ? b === null : b !== null && a.equals(b));

// Copies the files into backupDir/name, via a temp folder so a half-written snapshot never counts.
function snapshot(backupDir, name, files) {
  const tmp = path.join(backupDir, name + '.tmp');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp);
  for (const file of files) if (fs.existsSync(file)) fs.copyFileSync(file, path.join(tmp, path.basename(file)));
  fs.renameSync(tmp, path.join(backupDir, name));
}

// Returns { created: [names], deleted: [names], warning: string | null }.
function backupData({ backupDir, csvPath, tasksPath, now = new Date() }) {
  const result = { created: [], deleted: [], warning: null };
  if (!fs.existsSync(csvPath)) return result; // first run: nothing to protect yet
  fs.mkdirSync(backupDir, { recursive: true });

  const names = fs.readdirSync(backupDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const rolling = names.filter((n) => ROLLING_RE.test(n)).sort();
  const weekly = names.filter((n) => WEEKLY_RE.test(n)).sort();
  // weekly first so that, on a tie, the stable sort ends on the rolling snapshot
  const all = [...weekly.map((n) => ({ n, t: n.slice(7) })), ...rolling.map((n) => ({ n, t: n }))]
    .sort((a, b) => a.t.localeCompare(b.t));
  const newest = all.length ? all[all.length - 1].n : null;

  const csvName = path.basename(csvPath);
  const tasksName = tasksPath ? path.basename(tasksPath) : null;
  const csv = fs.readFileSync(csvPath);

  if (newest) {
    const old = readOrNull(path.join(backupDir, newest, csvName));
    if (old) {
      const have = countRows(csv.toString('utf8'));
      const had = countRows(old.toString('utf8'));
      if (have < had) {
        result.warning = `${csvName} has ${have} sessions, but the latest backup (backups/${newest}) has ${had}. ` +
          'It may have been overwritten. No backup was made and no old backup was deleted.';
        return result;
      }
    }
  }

  const files = tasksPath ? [csvPath, tasksPath] : [csvPath];
  const name = stamp(now);

  // Skip the rolling snapshot when nothing changed, so restarts alone never push out older copies.
  const last = rolling[rolling.length - 1];
  const unchanged = last &&
    sameBytes(csv, readOrNull(path.join(backupDir, last, csvName))) &&
    (!tasksName || sameBytes(readOrNull(tasksPath), readOrNull(path.join(backupDir, last, tasksName))));
  if (!unchanged && !rolling.includes(name)) {
    snapshot(backupDir, name, files);
    result.created.push(name);
    rolling.push(name);
  }
  for (const n of rolling.slice(0, Math.max(0, rolling.length - ROLLING_KEEP))) {
    fs.rmSync(path.join(backupDir, n), { recursive: true, force: true });
    result.deleted.push(n);
  }

  const lastWeekly = weekly[weekly.length - 1];
  if (!lastWeekly || now - parseStamp(lastWeekly.slice(7)) >= WEEK_MS) {
    const w = 'weekly_' + name;
    snapshot(backupDir, w, files);
    result.created.push(w);
    for (const n of weekly) {
      fs.rmSync(path.join(backupDir, n), { recursive: true, force: true });
      result.deleted.push(n);
    }
  }
  return result;
}

module.exports = { backupData, countRows, stamp, ROLLING_KEEP };
