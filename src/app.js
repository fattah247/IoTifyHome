import {
  SCENES,
  applyAutomationByHour,
  applyScene,
  createDefaultState,
  exportState,
  importState,
  setDevicePower,
  setLightBrightness,
  setLockState,
  setThermostatTemperature,
  summarize,
} from "./core.js";

const STORAGE_KEY = "iotifyhome_state_v1";
const AUTH_TOKEN_KEY = "iotifyhome_auth_token_v1";
const AUTH_USER_KEY = "iotifyhome_auth_user_v1";
const API_BASE_KEY = "iotifyhome_api_base_v1";
const AUTOMATION_PRESETS = [
  { hour: 8, label: "Morning" },
  { hour: 13, label: "Workday" },
  { hour: 20, label: "Evening" },
  { hour: 23, label: "Night" },
];

function inferDefaultApiBase() {
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    return window.location.origin;
  }
  return "http://127.0.0.1:4173";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clampHour(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(23, Math.max(0, Math.round(parsed)));
}

function readStoredState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return createDefaultState();
  return importState(raw, createDefaultState());
}

let state = readStoredState();
let transferBuffer = "";
let statusText = "";
let selectedAutomationHour = clampHour(new Date().getHours());
let authToken = sessionStorage.getItem(AUTH_TOKEN_KEY) || "";
let authUser = localStorage.getItem(AUTH_USER_KEY) || "";
let loginUsername = authUser;
let loginPassword = "";
let apiBase = localStorage.getItem(API_BASE_KEY) || inferDefaultApiBase();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function persistApiBase() {
  localStorage.setItem(API_BASE_KEY, apiBase);
}

function isAuthenticated() {
  return Boolean(authToken);
}

function setSession(token, username) {
  authToken = token ?? "";
  authUser = username ?? "";
  if (authToken) {
    sessionStorage.setItem(AUTH_TOKEN_KEY, authToken);
    localStorage.setItem(AUTH_USER_KEY, authUser);
  } else {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  }
}

async function apiRequest(path, { method = "GET", body, requiresAuth = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (requiresAuth) {
    if (!authToken) {
      throw new Error("Please sign in first.");
    }
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : {};
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function update(nextState) {
  state = nextState;
  saveState();
  render();
}

async function runCommand(localState, command, successMessage) {
  update(localState);
  if (!isAuthenticated()) {
    return;
  }
  try {
    const payload = await apiRequest("/api/device/command", {
      method: "POST",
      body: command,
      requiresAuth: true,
    });
    state = importState(JSON.stringify(payload.state), state);
    saveState();
    statusText = successMessage;
  } catch (error) {
    statusText = `Applied locally, cloud bridge failed: ${error.message}`;
  }
  render();
}

function sceneCard(scene, active) {
  return `
    <button class="scene ${active ? "active" : ""}" data-scene="${scene.id}">
      <strong>${escapeHtml(scene.label)}</strong>
      <span>${escapeHtml(scene.description)}</span>
    </button>
  `;
}

function deviceCard(device) {
  const powerText = device.on ? "On" : "Off";
  const controls = [];

  controls.push(`
    <label class="control-inline">
      <input type="checkbox" data-device-power="${device.id}" ${device.on ? "checked" : ""} />
      <span>${powerText}</span>
    </label>
  `);

  if (device.type === "light") {
    controls.push(`
      <label>
        Brightness
        <input type="range" min="0" max="100" value="${device.brightness}" data-light-brightness="${device.id}" />
        <small>${device.brightness}%</small>
      </label>
    `);
  }

  if (device.type === "thermostat") {
    controls.push(`
      <label>
        Temperature
        <input type="range" min="16" max="30" value="${device.temperature}" data-thermostat-temp="${device.id}" />
        <small>${device.temperature} C</small>
      </label>
    `);
  }

  if (device.type === "lock") {
    controls.push(`
      <label class="control-inline">
        <input type="checkbox" data-lock-state="${device.id}" ${device.locked ? "checked" : ""} />
        <span>${device.locked ? "Locked" : "Unlocked"}</span>
      </label>
    `);
  }

  return `
    <article class="device-card">
      <header>
        <h3>${escapeHtml(device.name)}</h3>
        <span class="badge">${escapeHtml(device.type)}</span>
      </header>
      <div class="controls">
        ${controls.join("")}
      </div>
    </article>
  `;
}

async function signIn(action) {
  const username = loginUsername.trim().toLowerCase();
  const password = loginPassword;
  if (!username || !password) {
    statusText = "Username and password are required.";
    render();
    return;
  }
  try {
    if (action === "register") {
      await apiRequest("/api/auth/register", {
        method: "POST",
        body: { username, password },
      });
    }
    const payload = await apiRequest("/api/auth/login", {
      method: "POST",
      body: { username, password },
    });
    setSession(payload.token, payload.user.username);
    loginPassword = "";
    statusText = `Signed in as ${payload.user.username}.`;
    await pullCloudState({ silentSuccess: true });
  } catch (error) {
    statusText = error.message;
  }
  render();
}

function signOut() {
  setSession("", "");
  loginPassword = "";
  statusText = "Signed out. Continuing in local-only mode.";
  render();
}

async function pushCloudState() {
  try {
    await apiRequest("/api/cloud/state", {
      method: "PUT",
      body: { state },
      requiresAuth: true,
    });
    statusText = "Cloud state updated.";
  } catch (error) {
    statusText = error.message;
  }
  render();
}

async function pullCloudState({ silentSuccess = false } = {}) {
  try {
    const payload = await apiRequest("/api/cloud/state", {
      method: "GET",
      requiresAuth: true,
    });
    state = importState(JSON.stringify(payload.state), state);
    saveState();
    if (!silentSuccess) {
      statusText = "Cloud state loaded.";
    }
  } catch (error) {
    statusText = error.message;
  }
}

function bindEvents(root) {
  root.querySelectorAll("[data-scene]").forEach((element) => {
    element.addEventListener("click", async (event) => {
      const sceneId = event.currentTarget.dataset.scene;
      await runCommand(applyScene(state, sceneId), { kind: "scene", sceneId }, `Scene "${sceneId}" synced.`);
    });
  });

  root.querySelectorAll("[data-device-power]").forEach((element) => {
    element.addEventListener("change", async (event) => {
      const id = event.currentTarget.dataset.devicePower;
      const on = event.currentTarget.checked;
      await runCommand(
        setDevicePower(state, id, on),
        { kind: "device-power", deviceId: id, on },
        `${id} power synced.`
      );
    });
  });

  root.querySelectorAll("[data-light-brightness]").forEach((element) => {
    element.addEventListener("change", async (event) => {
      const id = event.currentTarget.dataset.lightBrightness;
      const brightness = Number(event.currentTarget.value);
      await runCommand(
        setLightBrightness(state, id, brightness),
        { kind: "light-brightness", deviceId: id, brightness },
        `${id} brightness synced.`
      );
    });
  });

  root.querySelectorAll("[data-thermostat-temp]").forEach((element) => {
    element.addEventListener("change", async (event) => {
      const id = event.currentTarget.dataset.thermostatTemp;
      const temperature = Number(event.currentTarget.value);
      await runCommand(
        setThermostatTemperature(state, id, temperature),
        { kind: "thermostat-temperature", deviceId: id, temperature },
        `${id} temperature synced.`
      );
    });
  });

  root.querySelectorAll("[data-lock-state]").forEach((element) => {
    element.addEventListener("change", async (event) => {
      const id = event.currentTarget.dataset.lockState;
      const locked = event.currentTarget.checked;
      await runCommand(
        setLockState(state, id, locked),
        { kind: "lock-state", deviceId: id, locked },
        `${id} lock state synced.`
      );
    });
  });

  root.querySelectorAll("[data-automation-hour]").forEach((element) => {
    element.addEventListener("click", async (event) => {
      const hour = clampHour(event.currentTarget.dataset.automationHour);
      selectedAutomationHour = hour;
      await runCommand(
        applyAutomationByHour(state, hour),
        { kind: "automation", hour },
        `Automation synced for ${hour}:00.`
      );
    });
  });

  root.querySelector("[data-hour-slider]")?.addEventListener("input", (event) => {
    selectedAutomationHour = clampHour(event.currentTarget.value);
    render();
  });

  root.querySelector("[data-apply-slider-hour]")?.addEventListener("click", async () => {
    await runCommand(
      applyAutomationByHour(state, selectedAutomationHour),
      { kind: "automation", hour: selectedAutomationHour },
      `Automation synced for ${selectedAutomationHour}:00.`
    );
  });

  root.querySelector("[data-export-state]")?.addEventListener("click", () => {
    transferBuffer = exportState(state);
    statusText = "State exported to the text area.";
    render();
  });

  root.querySelector("[data-import-state]")?.addEventListener("click", () => {
    const field = root.querySelector("[data-transfer-buffer]");
    if (!field) {
      return;
    }
    if (field.value.length > 200_000) {
      statusText = "Import rejected: payload is too large.";
      render();
      return;
    }
    const next = importState(field.value, state);
    transferBuffer = field.value;
    statusText = next === state ? "Import ignored: invalid payload." : "State import applied.";
    update(next);
  });

  root.querySelector("[data-reset-state]")?.addEventListener("click", () => {
    state = createDefaultState();
    transferBuffer = "";
    statusText = "State reset to defaults.";
    saveState();
    render();
  });

  root.querySelector("[data-api-base]")?.addEventListener("change", (event) => {
    apiBase = event.currentTarget.value.trim() || inferDefaultApiBase();
    persistApiBase();
    statusText = `API base set to ${apiBase}`;
    render();
  });

  root.querySelector("[data-auth-username]")?.addEventListener("input", (event) => {
    loginUsername = event.currentTarget.value;
  });
  root.querySelector("[data-auth-password]")?.addEventListener("input", (event) => {
    loginPassword = event.currentTarget.value;
  });
  root.querySelector("[data-auth-login]")?.addEventListener("click", () => {
    signIn("login");
  });
  root.querySelector("[data-auth-register]")?.addEventListener("click", () => {
    signIn("register");
  });
  root.querySelector("[data-auth-logout]")?.addEventListener("click", () => {
    signOut();
  });
  root.querySelector("[data-cloud-pull]")?.addEventListener("click", () => {
    pullCloudState().then(render);
  });
  root.querySelector("[data-cloud-push]")?.addEventListener("click", () => {
    pushCloudState();
  });
}

function render() {
  const root = document.getElementById("app");
  const summary = summarize(state);
  const authStatus = isAuthenticated() ? `Signed in: ${authUser}` : "Not signed in";

  root.innerHTML = `
    <section class="hero">
      <h1>IoTifyHome Control Center</h1>
      <p>Use scene presets or fine-grained controls to manage your smart home in real time.</p>
      <p class="meta">Last updated: ${escapeHtml(new Date(state.updatedAt).toLocaleString())}</p>
    </section>

    <section class="panel cloud-panel">
      <div class="cloud-header">
        <h2>Cloud Auth & Sync</h2>
        <span class="pill ${isAuthenticated() ? "online" : "offline"}">${escapeHtml(authStatus)}</span>
      </div>
      <label>
        API Base URL
        <input type="url" value="${escapeHtml(apiBase)}" data-api-base />
      </label>
      <div class="auth-grid">
        <label>
          Username
          <input value="${escapeHtml(loginUsername)}" data-auth-username />
        </label>
        <label>
          Password
          <input type="password" value="${escapeHtml(loginPassword)}" data-auth-password />
        </label>
      </div>
      <div class="actions-row">
        <button type="button" data-auth-login>Sign In</button>
        <button type="button" data-auth-register>Register</button>
        <button type="button" class="ghost" data-auth-logout>Sign Out</button>
        <button type="button" class="secondary" data-cloud-pull>Pull Cloud State</button>
        <button type="button" class="secondary" data-cloud-push>Push Cloud State</button>
      </div>
      <p class="meta">Use HTTPS endpoints in production and keep token lifetime short.</p>
    </section>

    <section class="summary-grid">
      <article class="summary-card">
        <h2>Online Devices</h2>
        <p>${summary.poweredDevices} / ${summary.totalDevices}</p>
      </article>
      <article class="summary-card">
        <h2>Locked Doors</h2>
        <p>${summary.lockedDoors}</p>
      </article>
      <article class="summary-card">
        <h2>Average Temperature</h2>
        <p>${summary.averageTemperature ?? "--"} C</p>
      </article>
      <article class="summary-card">
        <h2>Estimated Power</h2>
        <p>${summary.estimatedPowerWatts} W</p>
      </article>
    </section>

    <section class="scene-grid">
      ${SCENES.map((scene) => sceneCard(scene, scene.id === state.scene)).join("")}
    </section>

    <section class="panel">
      <h2>Automation</h2>
      <p class="meta">Apply scene rules by hour of day.</p>
      <div class="automation-grid">
        ${AUTOMATION_PRESETS.map(
          (preset) => `
            <button type="button" class="chip" data-automation-hour="${preset.hour}">
              ${escapeHtml(preset.label)} (${preset.hour}:00)
            </button>
          `
        ).join("")}
      </div>
      <div class="slider-row">
        <label>
          Custom Hour: <strong>${selectedAutomationHour}:00</strong>
          <input type="range" min="0" max="23" step="1" value="${selectedAutomationHour}" data-hour-slider />
        </label>
        <button type="button" data-apply-slider-hour>Apply</button>
      </div>
      <p class="meta">${escapeHtml(statusText)}</p>
    </section>

    <section class="device-grid">
      ${state.devices.map((device) => deviceCard(device)).join("")}
    </section>

    <section class="panel transfer-panel">
      <h2>State Backup</h2>
      <p class="meta">Export current state or import a previous JSON snapshot.</p>
      <textarea data-transfer-buffer placeholder="Paste exported state JSON here...">${escapeHtml(transferBuffer)}</textarea>
      <div class="actions-row">
        <button type="button" data-export-state>Export Current State</button>
        <button type="button" data-import-state>Import State</button>
        <button type="button" class="danger" data-reset-state>Reset Defaults</button>
      </div>
    </section>

    <section class="panel event-log">
      <h2>Recent Events</h2>
      ${
        state.eventLog && state.eventLog.length
          ? `<ul>${state.eventLog
              .slice(0, 10)
              .map(
                (event) =>
                  `<li><strong>${escapeHtml(new Date(event.timestamp).toLocaleTimeString())}</strong> ${escapeHtml(event.message)}</li>`
              )
              .join("")}</ul>`
          : "<p class='meta'>No events yet. Start interacting with devices or scenes.</p>"
      }
    </section>
  `;

  bindEvents(root);
}

async function bootstrap() {
  render();
  if (!isAuthenticated()) {
    return;
  }
  try {
    await apiRequest("/api/auth/session", { requiresAuth: true });
    await pullCloudState({ silentSuccess: true });
  } catch {
    setSession("", "");
    statusText = "Session expired; continue locally or sign in again.";
  }
  render();
}

bootstrap();
