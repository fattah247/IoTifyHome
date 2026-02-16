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

export function setDevicePower(state, id, on) {
  return withUpdatedDevice(state, id, (device) => ({ ...device, on: Boolean(on) }));
}

export function setLightBrightness(state, id, brightness) {
  return withUpdatedDevice(state, id, (device) => {
    if (device.type !== "light") {
      return device;
    }
    return {
      ...device,
      on: true,
      brightness: clamp(Number(brightness), 0, 100),
    };
  });
}

export function setThermostatTemperature(state, id, temperature) {
  return withUpdatedDevice(state, id, (device) => {
    if (device.type !== "thermostat") {
      return device;
    }
    return {
      ...device,
      on: true,
      temperature: clamp(Number(temperature), 16, 30),
    };
  });
}

export function setLockState(state, id, locked) {
  return withUpdatedDevice(state, id, (device) => {
    if (device.type !== "lock") {
      return device;
    }
    return {
      ...device,
      locked: Boolean(locked),
      on: true,
    };
  });
}

export function applyScene(state, sceneId) {
  switch (sceneId) {
    case "away":
      return {
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
    case "evening":
      return {
        ...state,
        scene: sceneId,
        updatedAt: new Date().toISOString(),
        devices: state.devices.map((device) => {
          if (device.type === "light") return { ...device, on: true, brightness: 55 };
          if (device.type === "thermostat") return { ...device, on: true, temperature: 23 };
          return device;
        }),
      };
    case "home":
    default:
      return {
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
