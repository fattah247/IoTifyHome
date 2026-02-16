# IoTifyHome

IoTifyHome is a browser-based smart-home dashboard for controlling core home devices and applying quick scenes (`Home`, `Evening`, `Away`).

## Features

- Real-time device controls for lights, thermostat, lock, and camera power.
- Scene presets that apply practical whole-home changes.
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
- `src/core.js`: pure state logic and scene behavior.
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
