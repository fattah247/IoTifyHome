# IoTifyHome

IoTifyHome is a browser-based smart-home dashboard for controlling core home devices and applying quick scenes (`Home`, `Evening`, `Away`).

## Features

- Real-time device controls for lights, thermostat, lock, and camera power.
- Scene presets (`Home`, `Evening`, `Away`) for one-click whole-home changes.
- Hour-based automation presets and a custom-hour automation slider.
- State export/import for backup and migration between browsers.
- Event log with latest smart-home actions.
- Hardened import pipeline with schema validation/clamping for devices and logs.
- XSS-safe rendering for imported/state-driven content.
- State persistence in `localStorage`.
- Summary metrics:
  - online devices
  - locked doors
  - average thermostat temperature
  - estimated power draw
- Unit-tested core state engine in `src/core.js`.

## Project Structure

- `index.html`: app shell.
- `styles.css`: responsive UI styling.
- `src/core.js`: pure state logic, scene behavior, automation, import/export.
- `src/app.js`: DOM rendering + interactions.
- `src/core.test.js`: smoke/unit tests for logic.

## Run Locally

1. Serve static files from repo root:

```bash
python3 -m http.server 4173
```

2. Open `http://localhost:4173`.

## Validate Logic

```bash
npm test
```
