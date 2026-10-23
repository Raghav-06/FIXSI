/** Fixsi API (Express). */

import fs from "node:fs";
import path from "node:path";

import cors from "cors";
import express from "express";
import { z } from "zod";

import { EventBus } from "./agent/events.js";
import { Incident, demoIncident, demoIncidents, incidentFromDemo } from "./agent/incident.js";
import { RunManager, cleanupWorkspaces } from "./agent/runs.js";
import { getSettings } from "./config.js";
import { ensureTargetRepo, extractError, triggerBug } from "./demoShop.js";
import { GitHubClient, GitHubError } from "./integrations/github.js";
import { ModelRouter, TASK_TIERS } from "./llm/router.js";
import { loadRecordings } from "./replay/player.js";
import { RateLimiter, SIGNATURE_HEADER, clientIp, sign, verifySignature } from "./security.js";
import { Store } from "./storage/db.js";
import { TIMEOUT, logger } from "./util.js";

const log = logger("fixsi");
export const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const HEARTBEAT_MS = 15_000;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const MAX_REPLAYS_IN_FLIGHT = 20;
const MAX_WEBHOOK_BYTES = 200_000;
const CLOSED = Symbol("closed");

const RunRequest = z.object({
  source: z.enum(["demo", "paste", "github_issue"]),
  incident_id: z.string().max(100).nullish(),
  error_text: z.string().nullish(),
  logs: z.string().nullish(),
  issue_url: z.string().max(300).nullish(),
});

const WebhookPayload = z.object({
  error: z.string().max(50_000),
  title: z.string().max(200).nullish(),
  stack_trace: z.string().max(50_000).nullish(),
  logs: z.string().max(50_000).nullish(),
  incident_id: z.string().max(100).nullish(),
  service: z.string().max(100).nullish(),
});

/** Thrown inside handlers; rendered as {"detail": ...} like the original FastAPI API. */
export class HttpError extends Error {
  constructor(status, detail, { headers = {}, extra = {} } = {}) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.headers = headers;
    this.extra = extra;
  }
}

const limited = (message, retryAfter = 60) =>
  new HttpError(429, message, { headers: { "Retry-After": String(retryAfter) }, extra: { code: "rate_limited" } });

/** A JS stack trace pasted as text: an error line followed by "    at ..." frames. */
const looksLikeStack = (text) => /^\s+at .+/m.test(text);

/**
 * Build the app. Options are for tests: `settings`, a fake `llmClient`, a `sandbox`, and `githubFetch`
 * (a fetch replacement for the GitHub API). Returns the Express app; `app.locals.fixsi` holds the services
 * and `app.locals.close()` stops background runs and closes the database.
 */
export function createApp({ settings = getSettings(), llmClient = null, sandbox = null, githubFetch } = {}) {
  const incidentsDir = path.join(settings.demoShopSource, "incidents");
  const store = new Store(settings.databaseUrl);
  store.markInterrupted();
  const bus = new EventBus((event) => store.addEvent(event));
  const router = new ModelRouter(settings, { client: llmClient });
  const githubFactory = settings.githubConfigured ? () => new GitHubClient(settings, githubFetch) : null;
  const manager = new RunManager(settings, store, bus, router, { githubFactory, sandbox });
  const limiter = new RateLimiter(settings.rateLimitRunsPerHour);
  const recordings = loadRecordings();

  const target = settings.resolve(settings.targetRepoPath);
  try {
    if (ensureTargetRepo(target, settings.demoShopSource)) log.info(`created demo-shop target repo at ${target}`);
  } catch (err) {
    log.warn(`could not prepare target repo: ${err.message}`);
  }
  const removed = cleanupWorkspaces(settings.resolve(settings.workspacesDir));
  if (removed) log.info(`removed ${removed} stale workspaces`);

  const app = express();
  app.disable("x-powered-by");
  app.locals.fixsi = { settings, store, bus, manager, limiter, recordings };
  app.locals.close = () => {
    manager.cancelAll();
    store.close();
  };
  app.use(cors({
    origin: settings.corsOrigins, credentials: false, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "Last-Event-ID"],
  }));

  const checkLiveCapacity = (req, countIp = true) => {
    if (manager.activeLiveRuns >= settings.maxConcurrentRuns) {
      throw limited(`Fixsi is busy: ${settings.maxConcurrentRuns} live investigations are already running. `
        + "Try again in a minute, or watch a replay.", 60);
    }
    if (countIp) {
      const [ok, retry] = limiter.check(clientIp(req));
      if (!ok) {
        throw limited(`Rate limit reached: ${settings.rateLimitRunsPerHour} live runs per hour per visitor keeps the `
          + `public demo affordable. Try again in ${Math.max(1, Math.floor(retry / 60))} min.`, retry);
      }
    }
  };

  /** Start a replay for a demo incident when replay mode is active; returns null in live mode. */
  const startDemo = (data, source, overrides = null) => {
    let incident = incidentFromDemo(data, source);
    if (overrides) incident = incident.with(overrides);
    if (!settings.replayActive) return null;
    const recording = recordings[data.id];
    if (!recording) throw new HttpError(503, `No recording for ${data.id} and live mode is not configured.`);
    if (manager.activeTasks >= MAX_REPLAYS_IN_FLIGHT) throw limited("Too many replays in flight; try again shortly.", 10);
    return { run_id: manager.startReplay(incident, recording), mode: "replay" };
  };

  /** Shared by POST /api/webhooks/error and the internal 'Break it' trigger. Returns the JSON body. */
  const handleWebhook = (rawBody, signature, req) => {
    if (!settings.webhooksEnabled) throw new HttpError(503, "Webhooks are disabled (WEBHOOK_SECRET is not set).");
    if (rawBody.length > MAX_WEBHOOK_BYTES) throw new HttpError(413, "Payload too large.");
    if (!verifySignature(settings.webhookSecret, rawBody, signature)) throw new HttpError(401, "Invalid signature.");
    let payload;
    try {
      payload = WebhookPayload.parse(JSON.parse(rawBody.toString("utf8")));
    } catch {
      throw new HttpError(422, "Invalid payload.");
    }
    const data = payload.incident_id ? demoIncident(incidentsDir, payload.incident_id) : null;
    let incident;
    if (data) {
      const overrides = { logs: [data.logs, payload.logs].filter(Boolean).join("\n") };
      if (payload.stack_trace) overrides.stack_trace = payload.stack_trace;
      const replay = startDemo(data, "webhook", overrides);
      if (replay) return replay;
      incident = incidentFromDemo(data, "webhook").with(overrides);
    } else if (settings.replayActive) {
      throw new HttpError(503, "Live mode is required for non-demo webhooks.");
    } else {
      incident = new Incident({
        source: "webhook", title: payload.title ?? "", report: payload.error, stack_trace: payload.stack_trace ?? "",
        logs: payload.logs ?? "",
      });
    }
    checkLiveCapacity(req, false);
    return { run_id: manager.startLive(incident), mode: "live" };
  };

  // -- health / catalog ------------------------------------------------------------------
  app.get("/api/health", (req, res) => {
    const jobsReason = manager.sandbox.unavailableReason?.() ?? null;
    res.json({
      status: "ok",
      version: VERSION,
      mode: settings.replayActive ? "replay" : "live",
      llm: {
        configured: settings.llmConfigured, base_url: settings.nebiusBaseUrl,
        models: { nano: settings.nemotronNanoModel, super: settings.nemotronSuperModel, ultra: settings.nemotronUltraModel },
      },
      github: {
        configured: settings.githubConfigured,
        repo: settings.githubConfigured ? `${settings.githubRepoOwner}/${settings.githubRepoName}` : null,
      },
      sandbox: {
        mode: settings.sandboxMode,
        effective: settings.sandboxMode === "nebius_jobs" && jobsReason ? "local (jobs fallback)" : settings.sandboxMode,
        note: jobsReason,
      },
      webhooks: settings.webhooksEnabled,
      replays: Object.keys(recordings).sort(),
      limits: {
        runs_per_hour: settings.rateLimitRunsPerHour, max_concurrent_runs: settings.maxConcurrentRuns,
        max_input_bytes: settings.maxInputBytes,
      },
    });
  });

  app.get("/api/incidents", (req, res) => {
    res.json(demoIncidents(incidentsDir).map(({ trigger: _trigger, ...d }) => ({ ...d, has_replay: d.id in recordings })));
  });

  app.get("/api/stats", (req, res) => {
    res.json({
      ...store.stats(),
      routing: TASK_TIERS,
      models: { nano: settings.nemotronNanoModel, super: settings.nemotronSuperModel, ultra: settings.nemotronUltraModel },
    });
  });

  // -- runs --------------------------------------------------------------------------------
  app.post("/api/runs", express.json({ limit: "1mb" }), async (req, res) => {
    const parsed = RunRequest.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(422, z.prettifyError(parsed.error));
    const body = parsed.data;
    for (const name of ["error_text", "logs"]) {
      if (body[name] && Buffer.byteLength(body[name]) > settings.maxInputBytes) {
        throw new HttpError(413, `${name} is larger than ${Math.floor(settings.maxInputBytes / 1000)} KB.`);
      }
    }
    let incident;
    if (body.source === "demo") {
      const data = demoIncident(incidentsDir, body.incident_id ?? "");
      if (!data) throw new HttpError(404, "Unknown demo incident.");
      const replay = startDemo(data, "demo");
      if (replay) return res.status(201).json(replay);
      incident = incidentFromDemo(data);
    } else if (settings.replayActive) {
      throw new HttpError(503, "Pasted errors and GitHub issues need live mode: set NEBIUS_API_KEY "
        + "(and REPLAY_MODE=false). Demo incidents work in replay mode.");
    } else if (body.source === "paste") {
      const text = (body.error_text ?? "").trim();
      if (!text) throw new HttpError(422, "Paste an error, stack trace or bug description.");
      incident = new Incident({ source: "paste", report: text, stack_trace: looksLikeStack(text) ? text : "", logs: (body.logs ?? "").trim() });
    } else {
      if (!settings.githubConfigured) throw new HttpError(400, "GitHub is not configured on this server.");
      try {
        incident = await new GitHubClient(settings, githubFetch).fetchIssue(body.issue_url ?? "");
      } catch (err) {
        if (err instanceof GitHubError) throw new HttpError(400, err.message);
        throw err;
      }
    }
    checkLiveCapacity(req);
    limiter.hit(clientIp(req));
    res.status(201).json({ run_id: manager.startLive(incident), mode: "live" });
  });

  app.get("/api/runs", (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? "50", 10) || 50, 1), 200);
    res.json(store.listRuns(limit).map((r) => ({
      ...r, duration_ms: r.finished_at ? Math.trunc((r.finished_at - r.created_at) * 1000) : null,
    })));
  });

  app.get("/api/runs/:runId", (req, res) => {
    const run = store.getRun(req.params.runId);
    if (!run) throw new HttpError(404, "Run not found.");
    res.json({ ...run, events: store.events(req.params.runId) });
  });

  app.get("/api/runs/:runId/events", async (req, res) => {
    const { runId } = req.params;
    if (!store.getRun(runId, false)) throw new HttpError(404, "Run not found.");
    let cursor = Number.parseInt(req.get("Last-Event-ID") ?? req.query.after ?? "0", 10) || 0;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no", Connection: "keep-alive" });
    const write = (e) => {
      res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
      cursor = e.id;
      return e.type === "run_completed";
    };
    const q = bus.subscribe(runId);
    let closed = false;
    res.on("close", () => {
      closed = true;
      q.put(CLOSED);
    });
    try {
      res.write("retry: 3000\n\n");
      for (const e of store.events(runId, cursor)) if (write(e)) return;
      while (!closed) {
        const run = store.getRun(runId, false);
        if (run && TERMINAL_STATUSES.has(run.status) && q.size === 0) {
          for (const e of store.events(runId, cursor)) write(e);
          return;
        }
        const e = await q.get(HEARTBEAT_MS);
        if (e === CLOSED) return;
        if (e === TIMEOUT) {
          res.write(": ping\n\n");
          continue;
        }
        if (e.id <= cursor) continue;
        if (write(e)) return;
      }
    } finally {
      bus.unsubscribe(runId, q);
      res.end();
    }
  });

  app.post("/api/runs/:runId/cancel", (req, res) => {
    if (!store.getRun(req.params.runId, false)) throw new HttpError(404, "Run not found.");
    if (!manager.cancel(req.params.runId)) throw new HttpError(409, "Run is not active.");
    res.json({ cancelled: true });
  });

  app.get("/api/runs/:runId/patch", (req, res) => {
    const run = store.getRun(req.params.runId);
    if (!run) throw new HttpError(404, "Run not found.");
    const diff = run.result?.diff;
    if (!diff) throw new HttpError(404, "This run has no patch.");
    res.set("Content-Disposition", `attachment; filename="fixsi-${req.params.runId}.patch"`);
    res.type("text/x-diff").send(diff);
  });

  // -- webhooks + demo-shop ------------------------------------------------------------------
  app.post("/api/webhooks/error", express.raw({ type: () => true, limit: "1mb" }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.status(202).json(handleWebhook(raw, req.get(SIGNATURE_HEADER), req));
  });

  app.post("/api/demo-shop/break/:bugId", async (req, res) => {
    const data = demoIncident(incidentsDir, req.params.bugId);
    if (!data) throw new HttpError(404, "Unknown bug.");
    if (!settings.webhooksEnabled) throw new HttpError(503, "Set WEBHOOK_SECRET to enable the webhook auto-trigger demo.");
    if (!settings.replayActive) {
      checkLiveCapacity(req);
      limiter.hit(clientIp(req));
    }
    const [code, output] = await triggerBug(target, data.trigger);
    const { errorLine, trace } = extractError(output);
    const raw = Buffer.from(JSON.stringify({
      error: errorLine, title: data.title, stack_trace: trace,
      logs: `[demo-shop] unhandled error captured by error hook (exit=${code})\n${output.slice(-4000)}`,
      incident_id: req.params.bugId, service: "demo-shop",
    }));
    // Same path as an external webhook: signed, verified, then started.
    const out = handleWebhook(raw, sign(settings.webhookSecret, raw), req);
    res.status(202).json({ ...out, captured_error: errorLine, exit_code: code });
  });

  app.use("/api", (req, res) => {
    res.status(404).json({ detail: "Not Found" });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      res.set(err.headers).status(err.status).json({ detail: err.detail, ...err.extra });
    } else if (err?.type === "entity.too.large") {
      res.status(413).json({ detail: "Payload too large." });
    } else if (err?.type === "entity.parse.failed") {
      res.status(422).json({ detail: "Invalid JSON body." });
    } else {
      log.error(`${req.method} ${req.path} failed`, err);
      if (!res.headersSent) res.status(500).json({ detail: "Internal Server Error" });
      else res.end();
    }
  });

  return app;
}
