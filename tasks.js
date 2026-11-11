// Starting defaults for task types. After first run the list is edited in the app
// (gear icon on the Timer tab) and saved by the server in tasks.json.
//   ui       - label shown in the app (buttons, dashboard legend)
//   db       - value written to sessions.csv; changing it orphans old CSV rows
//   color    - dashboard chart color, #rrggbb
//   archived - optional; hidden from the timer but still valid in past reports
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tasks = factory();
})(this, function () {
  const DEFAULT_TASK_DEFS = [
    { ui: 'Job search',              db: 'Job search',              color: '#4e79a7' },
    { ui: 'Network',                 db: 'Network',                 color: '#f28e2b' },
    { ui: 'AI projects',             db: 'AI projects',             color: '#59a14f' },
    { ui: 'Interview prep (theory)', db: 'Interview prep (theory)', color: '#b07aa1' },
  ];

  const isName = (v) => typeof v === 'string' && v.trim() !== '' && v === v.trim();

  function validateTaskDefs(defs) {
    if (!Array.isArray(defs) || defs.length === 0) return 'Task list must be a non-empty array';
    const seen = new Set();
    for (const d of defs) {
      if (!d || typeof d !== 'object') return 'Task must be an object';
      if (!isName(d.ui)) return 'Invalid ui name: ' + JSON.stringify(d.ui);
      if (!isName(d.db)) return 'Invalid db name: ' + JSON.stringify(d.db);
      if (/[,\r\n]/.test(d.db)) return 'db name must not contain a comma or newline: ' + JSON.stringify(d.db);
      if (seen.has(d.db)) return 'Duplicate db name: ' + d.db;
      seen.add(d.db);
      if (d.archived !== undefined && typeof d.archived !== 'boolean') return 'archived must be true or false for ' + d.db;
      if (typeof d.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(d.color)) {
        return 'Invalid color for ' + d.db + ': ' + JSON.stringify(d.color);
      }
    }
    if (defs.every((d) => d.archived)) return 'At least one task type must stay active';
    return null;
  }

  return { DEFAULT_TASK_DEFS, validateTaskDefs };
});
