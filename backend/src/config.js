/** Settings loaded from environment variables (names match .env.example). */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PROJECT_DIR = path.dirname(BACKEND_DIR);

const DEFAULTS = {
  nebiusApiKey: "",
  nebiusBaseUrl: "https://api.tokenfactory.nebius.com/v1/",
  nemotronNanoModel: "nvidia/nemotron-3-nano-30b-a3b",
  nemotronSuperModel: "nvidia/nemotron-3-super-120b-a12b",
  nemotronUltraModel: "nvidia/nemotron-3-ultra-550b-a55b",
  llmTimeoutSeconds: 120,
  llmUseJsonMode: false,

  maxHypotheses: 4,
  maxFixAttempts: 3,
  maxTokensPerRun: 250_000,

  sandboxMode: "local",
  sandboxTimeoutSeconds: 120,
  workspacesDir: path.join(BACKEND_DIR, "data", "workspaces"),
  targetRepoPath: path.join(BACKEND_DIR, "data", "demo-shop-repo"),
  demoShopSource: path.join(BACKEND_DIR, "demo-shop"),

  nebiusJobsProjectId: "",
  nebiusJobsImage: "node:22-slim",
  nebiusJobsPlatform: "cpu-d3",
  nebiusJobsPreset: "4vcpu-16gb",
  nebiusJobsSubnetId: "",
  nebiusCliPath: "nebius",
  nebiusJobsTimeoutSeconds: 900,

  githubToken: "",
  githubRepoOwner: "",
  githubRepoName: "demo-shop",
  githubBaseBranch: "main",

  webhookSecret: "",

  rateLimitRunsPerHour: 5,
  maxConcurrentRuns: 2,
  replayMode: false,
  replaySpeed: 1.0,

  corsAllowedOrigins: "http://localhost:5173,http://localhost:3000",
  databaseUrl: `sqlite:///${path.join(BACKEND_DIR, "data", "fixsi.db")}`,

  // Input limits for pasted incidents.
  maxInputBytes: 50_000,
};

const CLAMP = { maxHypotheses: [2, 8], maxFixAttempts: [1, 10] };

/** camelCase setting name -> SCREAMING_SNAKE env var name. */
export function envName(key) {
  return key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
}

function coerce(key, raw) {
  const fallback = DEFAULTS[key];
  if (typeof fallback === "boolean") {
    return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
  }
  if (typeof fallback === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${envName(key)} must be a number, got ${JSON.stringify(raw)}`);
    return n;
  }
  return String(raw);
}

/** Read KEY=value pairs from .env files. Later files win; real environment variables win over both. */
export function readEnvFiles(files = [path.join(PROJECT_DIR, ".env"), path.join(BACKEND_DIR, ".env")]) {
  const out = {};
  for (const file of files) {
    try {
      Object.assign(out, parseEnv(fs.readFileSync(file, "utf8")));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  return out;
}

export class Settings {
  constructor(values) {
    Object.assign(this, values);
    for (const [key, [lo, hi]] of Object.entries(CLAMP)) {
      if (this[key] < lo || this[key] > hi) throw new Error(`${envName(key)} must be between ${lo} and ${hi}`);
    }
    Object.freeze(this);
  }

  /** Copy with some values replaced (camelCase keys). */
  with(overrides) {
    return new Settings({ ...this, ...overrides });
  }

  get llmConfigured() {
    return Boolean(this.nebiusApiKey.trim());
  }

  get githubConfigured() {
    return Boolean(this.githubToken && this.githubRepoOwner && this.githubRepoName);
  }

  get replayActive() {
    return this.replayMode || !this.llmConfigured;
  }

  get corsOrigins() {
    return this.corsAllowedOrigins.split(",").map((o) => o.trim()).filter(Boolean);
  }

  /** Relative paths in env are relative to backend/. */
  resolve(p) {
    return path.isAbsolute(p) ? p : path.resolve(BACKEND_DIR, p);
  }
}

/**
 * Build settings from defaults, then `env` (process env + .env files by default), then `overrides`.
 * Tests pass `{ env: {} }` to ignore the machine's environment entirely.
 */
export function makeSettings(overrides = {}, { env } = {}) {
  const source = env ?? { ...readEnvFiles(), ...process.env };
  const values = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const raw = source[envName(key)];
    if (raw !== undefined && raw !== "") values[key] = coerce(key, raw);
    else if (raw === "" && typeof DEFAULTS[key] === "string") values[key] = "";
  }
  return new Settings({ ...values, ...overrides });
}

let cached = null;

export function getSettings() {
  cached ??= makeSettings();
  return cached;
}
