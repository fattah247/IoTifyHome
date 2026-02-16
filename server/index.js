import crypto from "node:crypto";
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyAutomationByHour,
  applyScene,
  createDefaultState,
  importState,
  setDevicePower,
  setLightBrightness,
  setLockState,
  setThermostatTemperature,
} from "../src/core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_RUNTIME_DIR = path.join(__dirname, "data", "runtime");
const DEFAULT_USERS_FILE = path.join(DEFAULT_RUNTIME_DIR, "users.json");
const DEFAULT_STATES_FILE = path.join(DEFAULT_RUNTIME_DIR, "cloud-state.json");
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:4173", "http://127.0.0.1:4173"];
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60 * 12;
const MAX_BODY_BYTES = 250_000;

const STATIC_CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
]);

function parsePositiveInt(input, fallback) {
  const parsed = Number.parseInt(String(input ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeUsername(input) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

function isValidPassword(input) {
  const value = String(input ?? "");
  return value.length >= 10 && value.length <= 160;
}

function nowIso() {
  return new Date().toISOString();
}

function toBase64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64Url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signToken(payload, secret) {
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = toBase64Url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== "string") {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [header, body, signature] = parts;
  const expectedSignature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  const signatureBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (signatureBytes.length !== expectedBytes.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(signatureBytes, expectedBytes)) {
    return null;
  }
  try {
    const payload = JSON.parse(fromBase64Url(body));
    const expiresAt = Number(payload.exp ?? 0);
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt * 1000) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const hashed = hashPassword(password, user.passwordSalt).hash;
  return crypto.timingSafeEqual(Buffer.from(hashed), Buffer.from(user.passwordHash));
}

async function readJson(filePath, fallbackValue) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallbackValue;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(body);
}

function setSecurityHeaders(res, requestId) {
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
}

function setCorsHeaders(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }
  if (!allowedOrigins.includes(origin)) {
    return false;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return true;
}

async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error("request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("malformed JSON body");
    error.statusCode = 400;
    throw error;
  }
}

function parseAuthHeader(req) {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return "";
  }
  return token;
}

function applyDeviceCommand(state, command) {
  const kind = String(command?.kind ?? "").trim().toLowerCase();
  switch (kind) {
    case "scene":
      return applyScene(state, String(command.sceneId ?? "").trim().toLowerCase());
    case "automation":
      return applyAutomationByHour(state, Number(command.hour ?? 0));
    case "device-power":
      return setDevicePower(state, String(command.deviceId ?? ""), Boolean(command.on));
    case "light-brightness":
      return setLightBrightness(state, String(command.deviceId ?? ""), Number(command.brightness ?? 0));
    case "thermostat-temperature":
      return setThermostatTemperature(state, String(command.deviceId ?? ""), Number(command.temperature ?? 0));
    case "lock-state":
      return setLockState(state, String(command.deviceId ?? ""), Boolean(command.locked));
    default:
      throw new Error("Unsupported device command kind");
  }
}

function makeStaticFilePath(urlPath) {
  const requestPath = urlPath === "/" ? "/index.html" : urlPath;
  const normalized = path.posix.normalize(requestPath);
  if (normalized.startsWith("/server/") || normalized.includes("..")) {
    return null;
  }
  const candidate = path.resolve(PROJECT_ROOT, `.${normalized}`);
  if (!candidate.startsWith(PROJECT_ROOT)) {
    return null;
  }
  return candidate;
}

async function serveStatic(urlPath, res) {
  const filePath = makeStaticFilePath(urlPath);
  if (!filePath) {
    return false;
  }
  const extension = path.extname(filePath).toLowerCase();
  const contentType = STATIC_CONTENT_TYPES.get(extension);
  if (!contentType) {
    return false;
  }
  try {
    const data = await fs.readFile(filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.end(data);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function createIoTifyServer(options = {}) {
  const usersFile = options.usersFile ?? DEFAULT_USERS_FILE;
  const statesFile = options.statesFile ?? DEFAULT_STATES_FILE;
  const tokenSecret =
    options.tokenSecret ??
    process.env.IOTIFYHOME_TOKEN_SECRET ??
    "iotifyhome-dev-secret-change-me";
  const tokenTtlSeconds = parsePositiveInt(
    options.tokenTtlSeconds ?? process.env.IOTIFYHOME_TOKEN_TTL_SECONDS,
    DEFAULT_TOKEN_TTL_SECONDS
  );
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;

  let users = await readJson(usersFile, []);
  if (!Array.isArray(users)) {
    users = [];
  }
  let cloudStateByUser = await readJson(statesFile, {});
  if (!cloudStateByUser || typeof cloudStateByUser !== "object" || Array.isArray(cloudStateByUser)) {
    cloudStateByUser = {};
  }

  async function persistUsers() {
    await writeJson(usersFile, users);
  }

  async function persistCloudState() {
    await writeJson(statesFile, cloudStateByUser);
  }

  function currentStateForUser(userId) {
    const existing = cloudStateByUser[userId];
    if (!existing) {
      const fresh = createDefaultState();
      cloudStateByUser[userId] = fresh;
      return fresh;
    }
    return importState(JSON.stringify(existing), createDefaultState());
  }

  function createSessionForUser(user) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payload = {
      sub: user.id,
      username: user.username,
      iat: nowSeconds,
      exp: nowSeconds + tokenTtlSeconds,
    };
    return {
      token: signToken(payload, tokenSecret),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  }

  async function handleRequest(req, res) {
    const requestId = crypto.randomUUID();
    setSecurityHeaders(res, requestId);

    const corsAllowed = setCorsHeaders(req, res, allowedOrigins);
    if (!corsAllowed) {
      sendJson(res, 403, { error: "Origin is not allowed", requestId });
      return;
    }
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        status: "ok",
        service: "iotifyhome-server",
        timestamp: nowIso(),
        requestId,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/register") {
      const body = await readJsonBody(req);
      const username = normalizeUsername(body.username);
      const password = String(body.password ?? "");
      if (username.length < 3 || username.length > 40) {
        sendJson(res, 400, { error: "username must be between 3 and 40 characters" });
        return;
      }
      if (!isValidPassword(password)) {
        sendJson(res, 400, { error: "password must be between 10 and 160 characters" });
        return;
      }
      if (users.some((entry) => entry.username === username)) {
        sendJson(res, 409, { error: "username already exists" });
        return;
      }
      const hashed = hashPassword(password);
      const user = {
        id: crypto.randomUUID(),
        username,
        passwordSalt: hashed.salt,
        passwordHash: hashed.hash,
        createdAt: nowIso(),
      };
      users.push(user);
      cloudStateByUser[user.id] = createDefaultState();
      await persistUsers();
      await persistCloudState();
      const session = createSessionForUser(user);
      sendJson(res, 201, { user: { id: user.id, username: user.username }, ...session });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJsonBody(req);
      const username = normalizeUsername(body.username);
      const password = String(body.password ?? "");
      const user = users.find((entry) => entry.username === username);
      if (!user || !verifyPassword(password, user)) {
        sendJson(res, 401, { error: "invalid username/password" });
        return;
      }
      const session = createSessionForUser(user);
      sendJson(res, 200, { user: { id: user.id, username: user.username }, ...session });
      return;
    }

    const authToken = parseAuthHeader(req);
    const authPayload = verifyToken(authToken, tokenSecret);
    const authUser = authPayload
      ? users.find((entry) => entry.id === authPayload.sub && entry.username === authPayload.username)
      : null;

    if (req.method === "GET" && url.pathname === "/api/auth/session") {
      if (!authUser) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      sendJson(res, 200, {
        user: { id: authUser.id, username: authUser.username },
        expiresAt: new Date(authPayload.exp * 1000).toISOString(),
      });
      return;
    }

    if (!authUser && url.pathname.startsWith("/api/cloud/")) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    if (!authUser && url.pathname.startsWith("/api/device/")) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/cloud/state") {
      sendJson(res, 200, {
        state: currentStateForUser(authUser.id),
        syncedAt: nowIso(),
      });
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/cloud/state") {
      const body = await readJsonBody(req);
      const fallback = currentStateForUser(authUser.id);
      const next = importState(JSON.stringify(body.state ?? {}), fallback);
      cloudStateByUser[authUser.id] = next;
      await persistCloudState();
      sendJson(res, 200, { state: next, syncedAt: nowIso() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/device/command") {
      const body = await readJsonBody(req);
      const baseState = currentStateForUser(authUser.id);
      let nextState;
      try {
        nextState = applyDeviceCommand(baseState, body);
      } catch (error) {
        sendJson(res, 400, { error: error.message });
        return;
      }
      cloudStateByUser[authUser.id] = nextState;
      await persistCloudState();
      sendJson(res, 200, {
        state: nextState,
        commandAppliedAt: nowIso(),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/device/catalog") {
      const state = currentStateForUser(authUser.id);
      sendJson(res, 200, {
        devices: state.devices.map((device) => ({
          id: device.id,
          name: device.name,
          type: device.type,
          online: Boolean(device.on),
        })),
      });
      return;
    }

    if (req.method === "GET") {
      const served = await serveStatic(url.pathname, res);
      if (served) {
        return;
      }
    }

    sendJson(res, 404, { error: "not found", requestId });
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      const statusCode = Number(error?.statusCode ?? 500);
      sendJson(res, statusCode, {
        error: statusCode >= 500 ? "internal server error" : error.message,
      });
    });
  });

  return {
    server,
  };
}

export async function startServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 4173);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const { server } = await createIoTifyServer(options);

  await new Promise((resolve) => {
    server.listen(port, host, resolve);
  });

  console.log(`IoTifyHome running at http://${host}:${port}`);
  return server;
}

if (process.argv[1] === __filename) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
