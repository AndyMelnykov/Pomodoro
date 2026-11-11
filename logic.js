(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(this, function () {
  const TASKS = ['Job search', 'Network', 'AI projects', 'Interview prep (theory)'];
  const TASK_COLORS = {
    'Job search': '#4e79a7',
    'Network': '#f28e2b',
    'AI projects': '#59a14f',
    'Interview prep (theory)': '#b07aa1',
  };

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
    if (!TASKS.includes(task)) throw new Error('Unknown task: ' + task);
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

  return {
    TASKS, TASK_COLORS, formatHM, formatDuration, formatStamp, dateKey, addDays, isWeekday,
    createTimer, startTimer, pauseTimer, resumeTimer, activeMs, stopTimer,
    colorBand, ringFraction, setPlanned, adjustPlanned,
    CSV_HEADER, sessionToCsvRow, parseCsv, validateSession,
  };
});
