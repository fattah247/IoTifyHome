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

function withUpdatedDevice(state, id, updater) {
  const nextDevices = state.devices.map((device) => {
    if (device.id !== id) {
      return device;
    }
    return updater(device);
  });

  return {
    ...state,
    devices: nextDevices,
    updatedAt: new Date().toISOString(),
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
  const next = withUpdatedDevice(state, id, (device) => ({ ...device, on: Boolean(on) }));
  return withLog(next, `Power ${on ? "enabled" : "disabled"} for ${id}`);
}

export function setLightBrightness(state, id, brightness) {
  const next = withUpdatedDevice(state, id, (device) => {
    if (device.type !== "light") {
      return device;
    }
    return {
      ...device,
      on: true,
      brightness: clamp(Number(brightness), 0, 100),
    };
  });
  return withLog(next, `Brightness changed for ${id}`);
}

export function setThermostatTemperature(state, id, temperature) {
  const next = withUpdatedDevice(state, id, (device) => {
    if (device.type !== "thermostat") {
      return device;
    }
    return {
      ...device,
      on: true,
      temperature: clamp(Number(temperature), 16, 30),
    };
  });
  return withLog(next, `Temperature changed for ${id}`);
}

export function setLockState(state, id, locked) {
  const next = withUpdatedDevice(state, id, (device) => {
    if (device.type !== "lock") {
      return device;
    }
    return {
      ...device,
      locked: Boolean(locked),
      on: true,
    };
  });
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
    return {
      ...fallback,
      ...parsed,
      eventLog: Array.isArray(parsed.eventLog) ? parsed.eventLog.slice(0, 50) : [],
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
