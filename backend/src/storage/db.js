/** SQLite persistence for runs, events and model calls (Node's built-in node:sqlite). */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { BACKEND_DIR } from "../config.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  created_at REAL NOT NULL,
  finished_at REAL,
  source TEXT NOT NULL,
  incident_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT DEFAULT 'trigger',
  mode TEXT NOT NULL DEFAULT 'live',
  incident TEXT NOT NULL,
  result TEXT,
  tokens INTEGER DEFAULT 0,
  model_calls INTEGER DEFAULT 0,
  pr_url TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS events (
  pk INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  timestamp REAL NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_run_id ON events(run_id, seq);
CREATE TABLE IF NOT EXISTS model_calls (
  pk INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  created_at REAL NOT NULL,
  stage TEXT,
  task TEXT,
  tier TEXT,
  model TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  success INTEGER DEFAULT 1,
  fallback INTEGER DEFAULT 0,
  replay INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_model_calls_run_id ON model_calls(run_id);
CREATE INDEX IF NOT EXISTS ix_model_calls_tier ON model_calls(tier);
`;

const RUN_FIELDS = ["id", "created_at", "finished_at", "source", "incident_id", "title", "status", "stage", "mode",
  "tokens", "model_calls", "pr_url", "error"];
const UPDATABLE = new Set([...RUN_FIELDS.filter((f) => f !== "id"), "incident", "result"]);
const JSON_FIELDS = new Set(["incident", "result"]);
const TIERS = ["nano", "super", "ultra"];

/** `sqlite:///relative/or/absolute.db` (relative to backend/), a bare path, or `:memory:`. */
export function databasePath(url) {
  const file = url.startsWith("sqlite:///") ? url.slice("sqlite:///".length) : url;
  if (file === ":memory:") return file;
  return path.isAbsolute(file) ? file : path.resolve(BACKEND_DIR, file);
}

const now = () => Date.now() / 1000;
const plain = (row) => (row ? { ...row } : row);

export class Store {
  constructor(url) {
    const file = databasePath(url);
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  // runs -------------------------------------------------------------------------
  createRun({ id, source, incident_id = null, title, status = "queued", mode = "live", incident }) {
    this.db.prepare(`INSERT INTO runs (id, created_at, source, incident_id, title, status, mode, incident)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, now(), source, incident_id, title, status, mode, JSON.stringify(incident));
  }

  updateRun(runId, fields) {
    const keys = Object.keys(fields).filter((k) => UPDATABLE.has(k));
    if (!keys.length) return;
    const values = keys.map((k) => {
      const v = fields[k];
      if (JSON_FIELDS.has(k)) return v == null ? null : JSON.stringify(v);
      return v === undefined ? null : v;
    });
    this.db.prepare(`UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...values, runId);
  }

  getRun(runId, full = true) {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    if (!row) return null;
    const out = Object.fromEntries(RUN_FIELDS.map((k) => [k, row[k]]));
    if (full) {
      out.incident = JSON.parse(row.incident);
      out.result = row.result ? JSON.parse(row.result) : null;
    }
    return out;
  }

  listRuns(limit = 50) {
    return this.db.prepare(`SELECT ${RUN_FIELDS.join(", ")} FROM runs ORDER BY created_at DESC LIMIT ?`).all(limit).map(plain);
  }

  /** Runs left 'running' by a previous process can never finish. */
  markInterrupted() {
    this.db.prepare("UPDATE runs SET status = 'failed', error = 'interrupted by server restart' WHERE status IN ('queued', 'running')").run();
  }

  // events -----------------------------------------------------------------------
  addEvent(event) {
    this.db.prepare("INSERT INTO events (run_id, seq, type, timestamp, payload) VALUES (?, ?, ?, ?, ?)")
      .run(event.run_id, event.id, event.type, event.timestamp, JSON.stringify(event.payload));
  }

  events(runId, after = 0) {
    return this.db.prepare("SELECT * FROM events WHERE run_id = ? AND seq > ? ORDER BY seq").all(runId, after)
      .map((r) => ({ id: r.seq, run_id: r.run_id, type: r.type, timestamp: r.timestamp, payload: JSON.parse(r.payload) }));
  }

  lastEventId(runId) {
    return this.db.prepare("SELECT MAX(seq) AS m FROM events WHERE run_id = ?").get(runId)?.m ?? 0;
  }

  // model calls ------------------------------------------------------------------
  addModelCall(runId, call, replay = false) {
    this.db.prepare(`INSERT INTO model_calls (run_id, created_at, stage, task, tier, model, prompt_tokens, completion_tokens,
      latency_ms, success, fallback, replay) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      runId, now(), call.stage ?? null, call.task ?? null, call.tier ?? null, call.model ?? null, call.prompt_tokens ?? 0,
      call.completion_tokens ?? 0, call.latency_ms ?? 0, call.success === false ? 0 : 1, call.fallback ? 1 : 0, replay ? 1 : 0,
    );
  }

  stats() {
    const tiers = Object.fromEntries(TIERS.map((t) => [t, {
      tier: t, calls: 0, prompt_tokens: 0, completion_tokens: 0, avg_latency_ms: 0, fallbacks: 0, failures: 0,
      replay_calls: 0, live_calls: 0, tasks: {},
    }]));
    const latencyWeight = Object.fromEntries(TIERS.map((t) => [t, 0]));
    const rows = this.db.prepare(`SELECT tier, replay, COUNT(*) AS n, SUM(prompt_tokens) AS pt, SUM(completion_tokens) AS ct,
      AVG(latency_ms) AS lat, SUM(fallback) AS fb, SUM(1 - success) AS fails FROM model_calls GROUP BY tier, replay`).all();
    for (const r of rows) {
      const t = tiers[r.tier];
      if (!t) continue;
      t.calls += r.n;
      t.prompt_tokens += r.pt ?? 0;
      t.completion_tokens += r.ct ?? 0;
      t.fallbacks += r.fb ?? 0;
      t.failures += r.fails ?? 0;
      t[r.replay ? "replay_calls" : "live_calls"] += r.n;
      latencyWeight[r.tier] += (r.lat ?? 0) * r.n;
    }
    for (const t of Object.values(tiers)) {
      t.avg_latency_ms = t.calls ? Math.round(latencyWeight[t.tier] / t.calls) : 0;
    }
    const taskRows = this.db.prepare(`SELECT tier, task, COUNT(*) AS n, SUM(prompt_tokens + completion_tokens) AS tok
      FROM model_calls GROUP BY tier, task`).all();
    for (const r of taskRows) {
      if (tiers[r.tier]) tiers[r.tier].tasks[r.task] = { calls: r.n, tokens: r.tok ?? 0 };
    }
    const runs = this.db.prepare("SELECT COUNT(*) AS n FROM runs").get().n;
    const ok = this.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status = 'succeeded'").get().n;
    return { tiers: Object.values(tiers), runs, succeeded_runs: ok };
  }
}
