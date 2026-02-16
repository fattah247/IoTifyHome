import {
  SCENES,
  applyScene,
  createDefaultState,
  setDevicePower,
  setLightBrightness,
  setLockState,
  setThermostatTemperature,
  summarize,
} from "./core.js";

const STORAGE_KEY = "iotifyhome_state_v1";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.devices)) return createDefaultState();
    return parsed;
  } catch {
    return createDefaultState();
  }
}

let state = loadState();

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
      <strong>${scene.label}</strong>
      <span>${scene.description}</span>
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
        <h3>${device.name}</h3>
        <span class="badge">${device.type}</span>
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
}

function render() {
  const root = document.getElementById("app");
  const summary = summarize(state);

  root.innerHTML = `
    <section class="hero">
      <h1>IoTifyHome Control Center</h1>
      <p>Use scene presets or fine-grained controls to manage your smart home in real time.</p>
      <p class="meta">Last updated: ${new Date(state.updatedAt).toLocaleString()}</p>
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

    <section class="device-grid">
      ${state.devices.map((device) => deviceCard(device)).join("")}
    </section>
  `;

  bindEvents(root);
}

render();
