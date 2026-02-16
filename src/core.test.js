import test from "node:test";
import assert from "node:assert/strict";

import {
  applyScene,
  createDefaultState,
  setDevicePower,
  setLightBrightness,
  setLockState,
  setThermostatTemperature,
  summarize,
} from "./core.js";

test("light brightness update keeps value in expected range", () => {
  const state = createDefaultState();
  const next = setLightBrightness(state, "light-living", 999);
  const light = next.devices.find((device) => device.id === "light-living");
  assert.equal(light.brightness, 100);
});

test("thermostat clamps between 16 and 30", () => {
  const state = createDefaultState();
  const low = setThermostatTemperature(state, "thermostat-main", 10);
  const high = setThermostatTemperature(state, "thermostat-main", 40);

  assert.equal(low.devices.find((device) => device.id === "thermostat-main").temperature, 16);
  assert.equal(high.devices.find((device) => device.id === "thermostat-main").temperature, 30);
});

test("away scene powers down lights and locks doors", () => {
  const state = createDefaultState();
  const next = applyScene(state, "away");
  const lights = next.devices.filter((device) => device.type === "light");
  const locks = next.devices.filter((device) => device.type === "lock");

  assert.ok(lights.every((light) => !light.on && light.brightness === 0));
  assert.ok(locks.every((lock) => lock.locked));
});

test("summary reflects state changes", () => {
  const state = createDefaultState();
  const unlocked = setLockState(state, "lock-front", false);
  const poweredOff = setDevicePower(unlocked, "camera-porch", false);
  const summary = summarize(poweredOff);

  assert.equal(summary.totalDevices, 5);
  assert.equal(summary.lockedDoors, 0);
  assert.equal(summary.poweredDevices, 3);
});
