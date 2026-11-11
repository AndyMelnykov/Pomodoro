(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tasks.js'));
  else root.Logic = factory(root.Tasks);
})(this, function (Tasks) {
  // The task list lives in tasks.js. Everything here is keyed by the DB name.
  // The list is runtime state (setTasks); archived types stay valid for past sessions but cannot be started.
  let TASK_DEFS = [], ACTIVE_TASK_DEFS = [], TASKS = [], TASK_COLORS = {};
  function setTasks(defs) {
    const problem = Tasks.validateTaskDefs(defs);
    if (problem) throw new Error(problem);
    TASK_DEFS = defs.map((d) => ({ ...d }));
    ACTIVE_TASK_DEFS = TASK_DEFS.filter((t) => !t.archived);
    TASKS = TASK_DEFS.map((t) => t.db);
    TASK_COLORS = Object.fromEntries(TASK_DEFS.map((t) => [t.db, t.color]));
  }
  setTasks(Tasks.DEFAULT_TASK_DEFS);
  const taskLabel = (db) => (TASK_DEFS.find((t) => t.db === db) || { ui: db }).ui;

  // original: full list; draft: edited active rows in order; decisions: removed db -> 'archive' | 'delete' | { moveTo }
  function applyTaskEdits(original, draft, decisions) {
    const kept = new Set(draft.map((t) => t.db));
    const archivedBefore = original.filter((t) => t.archived);
    const removed = original.filter((t) => !t.archived && !kept.has(t.db));
    const remap = {};
    const newlyArchived = [];
    for (const t of removed) {
      const d = decisions[t.db];
      if (d === 'archive') newlyArchived.push({ ...t, archived: true });
      else if (d === 'delete') continue;
      else if (d && typeof d === 'object' && d.moveTo) remap[t.db] = d.moveTo;
      else throw new Error('No decision for removed task type: ' + t.db);
    }
    return { tasks: [...draft.map((t) => ({ ...t })), ...archivedBefore, ...newlyArchived], remap };
  }

  function remapTaskInCsv(text, from, to) {
    return text.split(/(\r?\n)/).map((part, i) => {
      if (i % 2 === 1) return part;
      const f = part.split(',');
      if (part !== CSV_HEADER && f.length === 6 && f[5] === from) { f[5] = to; return f.join(','); }
      return part;
    }).join('');
  }

  const pad = (n) => String(n).padStart(2, '0');

  function formatHM(minutes) {
    return pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);
  }

  function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
  }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function formatStamp(d) {
    return dateKey(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function keyToUtc(key) {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function addDays(key, n) {
    const d = new Date(keyToUtc(key) + n * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function isWeekday(key) {
    const dow = new Date(keyToUtc(key)).getUTCDay();
    return dow >= 1 && dow <= 5;
  }

  // ---- Timer engine (pure: every function returns a new state, never mutates) ----
  const MIN_PLANNED = 1;
  const MAX_PLANNED = 1439;
  const MIN_SAVED_MIN = 5;

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function createTimer(plannedMin = 45) {
    return { status: 'idle', task: null, plannedMin, startedAt: null, accumulatedMs: 0, resumedAt: null };
  }

  function startTimer(s, task, nowMs) {
    if (!ACTIVE_TASK_DEFS.some((t) => t.db === task)) throw new Error('Unknown task: ' + task);
    if (s.status !== 'idle') throw new Error('Timer is not idle');
    return { ...s, status: 'running', task, startedAt: nowMs, accumulatedMs: 0, resumedAt: nowMs };
  }

  function pauseTimer(s, nowMs) {
    if (s.status !== 'running') throw new Error('Timer is not running');
    return { ...s, status: 'paused', accumulatedMs: s.accumulatedMs + (nowMs - s.resumedAt), resumedAt: null };
  }

  function resumeTimer(s, nowMs) {
    if (s.status !== 'paused') throw new Error('Timer is not paused');
    return { ...s, status: 'running', resumedAt: nowMs };
  }

  function activeMs(s, nowMs) {
    return s.accumulatedMs + (s.status === 'running' ? nowMs - s.resumedAt : 0);
  }

  function stopTimer(s, nowMs) {
    if (s.status === 'idle') throw new Error('Timer is idle');
    const ms = activeMs(s, nowMs);
    const activeMin = Math.round(ms / 60000);
    const state = createTimer(s.plannedMin);
    if (activeMin < MIN_SAVED_MIN) return { state, session: null };
    return {
      state,
      session: {
        start: formatStamp(new Date(s.startedAt)),
        finish: formatStamp(new Date(nowMs)),
        plannedMin: s.plannedMin,
        activeMin,
        completionPct: Math.round(activeMin / s.plannedMin * 100),
        task: s.task,
      },
    };
  }

  function progress(ms, plannedMin) {
    return ms / (plannedMin * 60000);
  }

  function colorBand(ms, plannedMin) {
    const p = progress(ms, plannedMin);
    if (p < 0.75) return 'red';
    if (p < 0.90) return 'orange';
    if (p < 1.0) return 'green';
    return 'violet';
  }

  function ringFraction(ms, plannedMin) {
    return clamp(progress(ms, plannedMin), 0, 1);
  }

  function toInt(v) {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? 0 : n;
  }

  function setPlanned(hours, minutes) {
    const h = clamp(toInt(hours), 0, 23);
    const m = clamp(toInt(minutes), 0, 59);
    return clamp(h * 60 + m, MIN_PLANNED, MAX_PLANNED);
  }

  function adjustPlanned(plannedMin, field, delta) {
    const step = field === 'h' ? 60 : 1;
    return clamp(plannedMin + delta * step, MIN_PLANNED, MAX_PLANNED);
  }

  // ---- CSV format ----
  const CSV_HEADER = 'start,finish,planned_min,active_min,completion_pct,task';
  const STAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
  const isCount = (n) => Number.isInteger(n) && n >= 0;

  function sessionToCsvRow(s) {
    return [s.start, s.finish, s.plannedMin, s.activeMin, s.completionPct, s.task].join(',');
  }

  function validateSession(o) {
    if (!o || typeof o !== 'object') return 'Session must be an object';
    if (typeof o.start !== 'string' || !STAMP_RE.test(o.start)) return 'Invalid start';
    if (typeof o.finish !== 'string' || !STAMP_RE.test(o.finish)) return 'Invalid finish';
    if (!isCount(o.plannedMin) || o.plannedMin < 1) return 'Invalid plannedMin';
    if (!isCount(o.activeMin)) return 'Invalid activeMin';
    if (!isCount(o.completionPct)) return 'Invalid completionPct';
    if (!TASKS.includes(o.task)) return 'Unknown task';
    return null;
  }

  function parseCsv(text) {
    const sessions = [];
    let skipped = 0;
    for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
      if (line.trim() === '' || line === CSV_HEADER) continue;
      const f = line.split(',');
      const num = (v) => (/^\d+$/.test(v) ? Number(v) : NaN);
      const obj = f.length === 6
        ? { start: f[0], finish: f[1], plannedMin: num(f[2]), activeMin: num(f[3]), completionPct: num(f[4]), task: f[5] }
        : null;
      if (obj && validateSession(obj) === null) sessions.push(obj);
      else skipped++;
    }
    return { sessions, skipped };
  }

  // ---- Dashboard calculations ----
  const sessionDay = (s) => s.start.slice(0, 10);

  function filterByRange(sessions, fromKey, toKey) {
    return sessions.filter((s) => {
      const day = sessionDay(s);
      return day >= fromKey && day <= toKey;
    });
  }

  function emptyByTask() {
    const byTask = {};
    for (const t of TASKS) byTask[t] = 0;
    return byTask;
  }

  function summarize(sessions) {
    const byTask = emptyByTask();
    const days = new Set();
    const weekdayMin = new Map();
    let totalMin = 0, plannedMin = 0;
    for (const s of sessions) {
      totalMin += s.activeMin;
      plannedMin += s.plannedMin;
      byTask[s.task] += s.activeMin;
      const day = sessionDay(s);
      days.add(day);
      if (isWeekday(day)) weekdayMin.set(day, (weekdayMin.get(day) || 0) + s.activeMin);
    }
    let weekdayTotal = 0;
    for (const v of weekdayMin.values()) weekdayTotal += v;
    return {
      totalMin,
      completionPct: plannedMin > 0 ? Math.round(totalMin / plannedMin * 100) : null,
      avgPerDayMin: days.size > 0 ? Math.round(totalMin / days.size) : null,
      avgPerWeekdayMin: weekdayMin.size > 0 ? Math.round(weekdayTotal / weekdayMin.size) : null,
      byTask,
    };
  }

  function dailyByTask(sessions, fromKey, toKey) {
    const days = [];
    for (let k = fromKey; k <= toKey; k = addDays(k, 1)) days.push(k);
    const index = new Map(days.map((k, i) => [k, i]));
    const series = {};
    for (const t of TASKS) series[t] = days.map(() => 0);
    for (const s of sessions) {
      const i = index.get(sessionDay(s));
      if (i !== undefined) series[s.task][i] += s.activeMin;
    }
    return { days, series };
  }

  function weekRange(d) {
    const key = dateKey(d);
    const dow = new Date(keyToUtc(key)).getUTCDay(); // 0 = Sunday
    const from = addDays(key, -((dow + 6) % 7));
    return { from, to: addDays(from, 6) };
  }

  function shiftRange(range, days) {
    return { from: addDays(range.from, days), to: addDays(range.to, days) };
  }

  const canGoForward = (toKey, todayKey) => toKey < todayKey;

  // Types a chart should draw: every active type in button order, then archived types that have
  // minutes in this data. Values may be numbers (summarize byTask) or per-day arrays (dailyByTask series).
  function shownTypes(minutesByDb) {
    const total = (v) => (Array.isArray(v) ? v.reduce((a, b) => a + b, 0) : v || 0);
    return [
      ...ACTIVE_TASK_DEFS.map((t) => t.db),
      ...TASK_DEFS.filter((t) => t.archived && total(minutesByDb[t.db]) > 0).map((t) => t.db),
    ];
  }

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayLabel(key) {
    const d = new Date(keyToUtc(key));
    return DAY_NAMES[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTH_NAMES[d.getUTCMonth()];
  }

  const api = {
    setTasks, applyTaskEdits, remapTaskInCsv, taskLabel, formatHM, formatDuration, formatStamp, dateKey, addDays, isWeekday,
    createTimer, startTimer, pauseTimer, resumeTimer, activeMs, stopTimer,
    colorBand, ringFraction, setPlanned, adjustPlanned,
    CSV_HEADER, sessionToCsvRow, parseCsv, validateSession,
    sessionDay, filterByRange, summarize, dailyByTask, weekRange, shiftRange, canGoForward,
    shownTypes, dayLabel,
  };
  // live views of the current task list (they change when setTasks is called)
  const live = { TASK_DEFS: () => TASK_DEFS, ACTIVE_TASK_DEFS: () => ACTIVE_TASK_DEFS, TASKS: () => TASKS, TASK_COLORS: () => TASK_COLORS };
  for (const [name, get] of Object.entries(live)) Object.defineProperty(api, name, { get, enumerable: true });
  return api;
});
