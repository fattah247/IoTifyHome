# IoTifyHome

IoTifyHome is a smart-home dashboard with a real backend for authentication, cloud state sync, and command routing to a device bridge.

## What is now production-useful

- Local-first controls for lights, thermostat, lock, and camera power.
- Cloud user auth (`register`, `login`, `session validation`) with signed bearer tokens.
- Per-user cloud state sync (`pull` / `push`) and persisted runtime data on server.
- Device bridge endpoint that accepts normalized commands (`scene`, `automation`, `power`, `brightness`, `temperature`, `lock`).
- Input/body-size validation, CORS allowlist, and hardening response headers.
- State backup export/import and schema-safe state sanitization.
- Unit tests for both state logic and backend smoke flows.

## Project Structure

- `src/core.js`: pure state logic, sanitization, scene + automation rules.
- `src/app.js`: UI, auth controls, local/cloud sync flow, and bridge command dispatch.
- `server/index.js`: HTTP server, auth, cloud state persistence, and static serving.
- `server/server.test.js`: API smoke tests for auth + sync + command routes.

## Run Locally

1. Start app + API together:

```bash
npm start
```

2. Open:

```text
http://127.0.0.1:4173
```

3. Register a user in the app’s `Cloud Auth & Sync` panel, then use `Pull Cloud State` / `Push Cloud State`.

## Validation

```bash
npm test
```

## Environment Variables

- `PORT`: server port (default `4173`)
- `HOST`: bind host (default `127.0.0.1`)
- `IOTIFYHOME_TOKEN_SECRET`: token signing secret
- `IOTIFYHOME_TOKEN_TTL_SECONDS`: auth token lifetime
