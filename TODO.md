# TODO

## Bugs

- **Unsaved session can be orphaned by the task type editor.** After a save fails (the error panel with
  Retry / Copy is showing), the gear button is still enabled, because it only checks that the timer is idle
  (`index.html`, `render()`: `btn-edit-tasks.disabled = !idle`). If the type of that unsaved session is then
  renamed (Name in CSV), moved or removed:
  - **Retry save** gets `400 Unknown task`.
  - A row pasted from **Copy session** is skipped by the dashboard as an unknown task.
  - The editor's session count reads `sessions.csv` only, so it does not see the unsaved session and may
    delete the type without asking.

  Fix: also disable the gear while `pendingSession` is set (and say why in its tooltip).
  Low priority: only happens if you edit task types while a save is pending.
