# Pomodoro

A small local Pomodoro-style focus timer that logs every work session to a CSV file, so you can see where your time actually goes.

No framework, no build step, no dependencies to install — just Node.js and a browser.

## Features

- **Planned-duration timer** with a progress ring that changes color as the planned time runs out
- **Task types** you can edit in the app (gear icon on the Timer tab): name, chart color, and archiving of old types
- **Session log** appended to `sessions.csv` (start, finish, planned minutes, active minutes, completion %, task)
- **Local-only server** bound to `127.0.0.1`, serving a fixed set of files and a tiny `/api/tasks` endpoint
- Renaming a task type can also rename it in past sessions
- Dashboard calculations in `logic.js` (the Dashboard tab UI is still a placeholder)

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer (uses the built-in `node:test` runner)
- A modern browser

## Run

```bash
node server.js
```

Then open <http://127.0.0.1:8765/>.

On Windows, `start.bat` starts the server and opens Chrome for you.

## Test

```bash
node --test
```

## Project layout

| File | Purpose |
| --- | --- |
| `index.html` | The whole UI (Timer and Dashboard tabs) |
| `logic.js` | Timer engine, CSV format, date/format helpers, dashboard calculations |
| `tasks.js` | Default task types and validation |
| `server.js` | Local HTTP server, CSV and task persistence |
| `chart.umd.js` | Vendored [Chart.js](https://www.chartjs.org/) |
| `test/` | Unit and server tests |

## Your data

`sessions.csv`, `tasks.json` and `tasks.json.tmp` are created on first run and are git-ignored, so your session history stays on your machine.
