export const SCENES = [
  {
    id: "home",
    label: "Home",
    description: "Comfort profile for active hours.",
  },
  {
    id: "evening",
    label: "Evening",
    description: "Warm lights and moderate thermostat.",
  },
  {
    id: "away",
    label: "Away",
    description: "Energy-saving mode while outside.",
  },
];

const ALLOWED_DEVICE_TYPES = new Set(["light", "thermostat", "lock", "camera"]);
const DEVICE_ID_PATTERN = /^[a-z0-9-]{3,64}$/;

export function createDefaultState() {
  return {
    scene: "home",
    devices: [
      { id: "light-living", type: "light", name: "Living Room Light", on: true, brightness: 70 },
      { id: "light-kitchen", type: "light", name: "Kitchen Light", on: false, brightness: 40 },
      { id: "thermostat-main", type: "thermostat", name: "Main Thermostat", on: true, temperature: 24 },
      { id: "lock-front", type: "lock", name: "Front Door Lock", locked: true, on: true },
      { id: "camera-porch", type: "camera", name: "Porch Camera", on: true },
    ],
    eventLog: [],
    updatedAt: new Date().toISOString(),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeText(input, { fallback = "", maxLength = 80 } = {}) {
  return (input ?? fallback).toString().trim().slice(0, maxLength);
}

function normalizeTimestamp(input) {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function normalizeDevice(input, index) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const type = sanitizeText(input.type, { fallback: "", maxLength: 20 }).toLowerCase();
  if (!ALLOWED_DEVICE_TYPES.has(type)) {
    return null;
  }

  const rawId = sanitizeText(input.id, { fallback: "", maxLength: 64 }).toLowerCase();
  const id = DEVICE_ID_PATTERN.test(rawId) ? rawId : `${type}-${index + 1}`;
  const name = sanitizeText(input.name, { fallback: `${type} ${index + 1}`, maxLength: 60 }) || `${type} ${index + 1}`;
  const base = {
    id,
    type,
    name,
    on: Boolean(input.on),
  };

  if (type === "light") {
    const brightness = Number.isFinite(Number(input.brightness)) ? Number(input.brightness) : 0;
    return {
      ...base,
      brightness: clamp(brightness, 0, 100),
    };
  }
  if (type === "thermostat") {
    const temperature = Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 22;
    return {
      ...base,
      temperature: clamp(temperature, 16, 30),
    };
  }
  if (type === "lock") {
    return {
      ...base,
      locked: Boolean(input.locked),
    };
  }
  return base;
}

function normalizeEventLog(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((entry) => entry && typeof entry === "object")
    .slice(0, 50)
    .map((entry, index) => ({
      id: sanitizeText(entry.id, { fallback: `log-${index + 1}`, maxLength: 64 }) || `log-${index + 1}`,
      message: sanitizeText(entry.message, { fallback: "Unknown event", maxLength: 140 }) || "Unknown event",
      timestamp: normalizeTimestamp(entry.timestamp),
    }));
}

function withUpdatedDevice(state, id, updater) {
  let found = false;
  const nextDevices = state.devices.map((device) => {
    if (device.id !== id) {
      return device;
    }
    found = true;
    return updater(device);
  });

  if (!found) {
    return null;
  }

  return {
    state: {
      ...state,
      devices: nextDevices,
      updatedAt: new Date().toISOString(),
    },
    found,
  };
}

function withLog(state, message) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    message,
    timestamp: new Date().toISOString(),
  };

  return {
    ...state,
    eventLog: [entry, ...(state.eventLog || [])].slice(0, 50),
  };
}

export function setDevicePower(state, id, on) {
  const updated = withUpdatedDevice(state, id, (device) => ({ ...device, on: Boolean(on) }));
  if (!updated) {
    return withLog(state, `Ignored power change for unknown device ${id}`);
  }
  const next = updated.state;
  return withLog(next, `Power ${on ? "enabled" : "disabled"} for ${id}`);
}

export function setLightBrightness(state, id, brightness) {
  const updated = withUpdatedDevice(state, id, (device) => {
    if (device.type !== "light") {
      return device;
    }
    return {
      ...device,
      on: true,
      brightness: clamp(Number(brightness), 0, 100),
    };
  });
  if (!updated) {
    return withLog(state, `Ignored brightness change for unknown device ${id}`);
  }
  const next = updated.state;
  return withLog(next, `Brightness changed for ${id}`);
}

export function setThermostatTemperature(state, id, temperature) {
  const updated = withUpdatedDevice(state, id, (device) => {
    if (device.type !== "thermostat") {
      return device;
    }
    return {
      ...device,
      on: true,
      temperature: clamp(Number(temperature), 16, 30),
    };
  });
  if (!updated) {
    return withLog(state, `Ignored temperature change for unknown device ${id}`);
  }
  const next = updated.state;
  return withLog(next, `Temperature changed for ${id}`);
}

export function setLockState(state, id, locked) {
  const updated = withUpdatedDevice(state, id, (device) => {
    if (device.type !== "lock") {
      return device;
    }
    return {
      ...device,
      locked: Boolean(locked),
      on: true,
    };
  });
  if (!updated) {
    return withLog(state, `Ignored lock change for unknown device ${id}`);
  }
  const next = updated.state;
  return withLog(next, `${locked ? "Locked" : "Unlocked"} ${id}`);
}

export function applyScene(state, sceneId, options = {}) {
  const log = options.log ?? true;
  let next;
  switch (sceneId) {
    case "away":
      next = {
        ...state,
        scene: sceneId,
        updatedAt: new Date().toISOString(),
        devices: state.devices.map((device) => {
          if (device.type === "light") return { ...device, on: false, brightness: 0 };
          if (device.type === "thermostat") return { ...device, on: true, temperature: 20 };
          if (device.type === "lock") return { ...device, locked: true, on: true };
          return { ...device, on: true };
        }),
      };
      break;
    case "evening":
      next = {
        ...state,
        scene: sceneId,
        updatedAt: new Date().toISOString(),
        devices: state.devices.map((device) => {
          if (device.type === "light") return { ...device, on: true, brightness: 55 };
          if (device.type === "thermostat") return { ...device, on: true, temperature: 23 };
          return device;
        }),
      };
      break;
    case "home":
    default:
      next = {
        ...state,
        scene: "home",
        updatedAt: new Date().toISOString(),
        devices: state.devices.map((device) => {
          if (device.type === "light" && device.brightness === 0) {
            return { ...device, on: true, brightness: 60 };
          }
          return device;
        }),
      };
      break;
  }
  if (!log) {
    return next;
  }
  return withLog(next, `Scene changed to ${sceneId}`);
}

export function applyAutomationByHour(state, hour) {
  const value = Number(hour);
  if (value >= 9 && value < 18) {
    return withLog(
      applyScene(state, "away", { log: false }),
      "Automation applied for daytime away hours"
    );
  }
  if (value >= 18 && value < 23) {
    return withLog(
      applyScene(state, "evening", { log: false }),
      "Automation applied for evening hours"
    );
  }
  return withLog(
    applyScene(state, "home", { log: false }),
    "Automation applied for home comfort hours"
  );
}

export function exportState(state) {
  return JSON.stringify(state, null, 2);
}

export function importState(rawState, fallback = createDefaultState()) {
  try {
    const parsed = JSON.parse(rawState);
    if (!parsed || !Array.isArray(parsed.devices)) {
      return fallback;
    }

    const normalizedDevices = parsed.devices
      .map((device, index) => normalizeDevice(device, index))
      .filter(Boolean);
    if (!normalizedDevices.length) {
      return fallback;
    }

    const sceneIds = new Set(SCENES.map((scene) => scene.id));
    const nextScene = sceneIds.has(parsed.scene) ? parsed.scene : fallback.scene;

    return {
      ...fallback,
      ...parsed,
      scene: nextScene,
      devices: normalizedDevices,
      eventLog: normalizeEventLog(parsed.eventLog),
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return fallback;
  }
}

export function summarize(state) {
  const poweredDevices = state.devices.filter((device) => device.on).length;
  const lockedDoors = state.devices.filter((device) => device.type === "lock" && device.locked).length;
  const thermostats = state.devices.filter((device) => device.type === "thermostat");
  const averageTemperature =
    thermostats.length > 0
      ? Math.round(
          thermostats.reduce((sum, thermostat) => sum + thermostat.temperature, 0) / thermostats.length
        )
      : null;

  const estimatedPowerWatts = state.devices.reduce((sum, device) => {
    if (!device.on) return sum;
    if (device.type === "light") return sum + Math.round(device.brightness * 0.7);
    if (device.type === "thermostat") return sum + 1500;
    if (device.type === "camera") return sum + 12;
    if (device.type === "lock") return sum + 4;
    return sum;
  }, 0);

  return {
    poweredDevices,
    totalDevices: state.devices.length,
    lockedDoors,
    averageTemperature,
    estimatedPowerWatts,
  };
}
