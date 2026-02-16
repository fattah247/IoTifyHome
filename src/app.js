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
const AUTOMATION_PRESETS = [
  { hour: 8, label: "Morning" },
  { hour: 13, label: "Workday" },
  { hour: 20, label: "Evening" },
  { hour: 23, label: "Night" },
];

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

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return createDefaultState();
  return importState(raw, createDefaultState());
}

let state = loadState();
let transferBuffer = "";
let statusText = "";
let selectedAutomationHour = clampHour(new Date().getHours());

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function update(nextState) {
  state = nextState;
  saveState();
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

function bindEvents(root) {
  root.querySelectorAll("[data-scene]").forEach((element) => {
    element.addEventListener("click", (event) => {
      const sceneId = event.currentTarget.dataset.scene;
      update(applyScene(state, sceneId));
    });
  });

  root.querySelectorAll("[data-device-power]").forEach((element) => {
    element.addEventListener("change", (event) => {
      const id = event.currentTarget.dataset.devicePower;
      update(setDevicePower(state, id, event.currentTarget.checked));
    });
  });

  root.querySelectorAll("[data-light-brightness]").forEach((element) => {
    element.addEventListener("input", (event) => {
      const id = event.currentTarget.dataset.lightBrightness;
      update(setLightBrightness(state, id, event.currentTarget.value));
    });
  });

  root.querySelectorAll("[data-thermostat-temp]").forEach((element) => {
    element.addEventListener("input", (event) => {
      const id = event.currentTarget.dataset.thermostatTemp;
      update(setThermostatTemperature(state, id, event.currentTarget.value));
    });
  });

  root.querySelectorAll("[data-lock-state]").forEach((element) => {
    element.addEventListener("change", (event) => {
      const id = event.currentTarget.dataset.lockState;
      update(setLockState(state, id, event.currentTarget.checked));
    });
  });

  root.querySelectorAll("[data-automation-hour]").forEach((element) => {
    element.addEventListener("click", (event) => {
      const hour = clampHour(event.currentTarget.dataset.automationHour);
      selectedAutomationHour = hour;
      statusText = `Applied automation for ${hour}:00.`;
      update(applyAutomationByHour(state, hour));
    });
  });

  root.querySelector("[data-hour-slider]")?.addEventListener("input", (event) => {
    selectedAutomationHour = clampHour(event.currentTarget.value);
    render();
  });

  root.querySelector("[data-apply-slider-hour]")?.addEventListener("click", () => {
    statusText = `Applied automation for ${selectedAutomationHour}:00.`;
    update(applyAutomationByHour(state, selectedAutomationHour));
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
}

function render() {
  const root = document.getElementById("app");
  const summary = summarize(state);

  root.innerHTML = `
    <section class="hero">
      <h1>IoTifyHome Control Center</h1>
      <p>Use scene presets or fine-grained controls to manage your smart home in real time.</p>
      <p class="meta">Last updated: ${escapeHtml(new Date(state.updatedAt).toLocaleString())}</p>
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

render();
