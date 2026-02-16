import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createIoTifyServer } from "./index.js";

async function withServer(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "iotifyhome-server-test-"));
  const usersFile = path.join(tempDir, "users.json");
  const statesFile = path.join(tempDir, "cloud-state.json");

  const { server } = await createIoTifyServer({
    usersFile,
    statesFile,
    tokenSecret: "test-secret",
    allowedOrigins: ["http://localhost:4173"],
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("auth registration + cloud sync + command bridge works end-to-end", async () => {
  await withServer(async (baseUrl) => {
    const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "house.admin",
        password: "safe-password-1234",
      }),
    });
    assert.equal(registerResponse.status, 201);
    const registerPayload = await registerResponse.json();
    assert.ok(registerPayload.token);

    const stateResponse = await fetch(`${baseUrl}/api/cloud/state`, {
      headers: { Authorization: `Bearer ${registerPayload.token}` },
    });
    assert.equal(stateResponse.status, 200);
    const statePayload = await stateResponse.json();
    assert.equal(statePayload.state.scene, "home");

    const commandResponse = await fetch(`${baseUrl}/api/device/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${registerPayload.token}`,
      },
      body: JSON.stringify({
        kind: "scene",
        sceneId: "away",
      }),
    });
    assert.equal(commandResponse.status, 200);
    const commandPayload = await commandResponse.json();
    assert.equal(commandPayload.state.scene, "away");

    const pushResponse = await fetch(`${baseUrl}/api/cloud/state`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${registerPayload.token}`,
      },
      body: JSON.stringify({
        state: {
          scene: "evening",
          devices: commandPayload.state.devices,
          eventLog: [],
        },
      }),
    });
    assert.equal(pushResponse.status, 200);
    const pushPayload = await pushResponse.json();
    assert.equal(pushPayload.state.scene, "evening");
  });
});

test("protected routes reject unauthorized calls", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/cloud/state`);
    assert.equal(response.status, 401);
  });
});

test("invalid login is rejected", async () => {
  await withServer(async (baseUrl) => {
    await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "operator",
        password: "super-safe-password",
      }),
    });

    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "operator",
        password: "wrong-pass",
      }),
    });
    assert.equal(response.status, 401);
  });
});
