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

  return { TASKS, TASK_COLORS, formatHM, formatDuration, formatStamp, dateKey, addDays, isWeekday };
});
