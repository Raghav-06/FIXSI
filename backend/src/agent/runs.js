/** Run manager: starts investigation runs (live or replay) as background tasks that can be cancelled. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { BudgetExceeded, LLMError } from "../llm/router.js";
import { play } from "../replay/player.js";
import { makeSandbox } from "../sandbox/nebiusJobs.js";
import { CancelledError, isCancelled, logger } from "../util.js";
import { Orchestrator, RunFailed } from "./orchestrator.js";
import { Workspace } from "./tools.js";

const log = logger("fixsi.runs");

export class RunManager {
  constructor(settings, store, bus, router, { githubFactory = null, sandbox = null } = {}) {
    this.settings = settings;
    this.store = store;
    this.bus = bus;
    this.router = router;
    this.githubFactory = githubFactory;
    this.sandbox = sandbox ?? makeSandbox(settings);
    this.tasks = new Map(); // runId -> { controller, promise, done }
    this.live = new Set();
  }

  get activeLiveRuns() {
    return this.live.size;
  }

  get activeTasks() {
    return [...this.tasks.values()].filter((t) => !t.done).length;
  }

  newId() {
    const d = new Date();
    const mmdd = String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    return `${mmdd}-${crypto.randomBytes(3).toString("hex")}`;
  }

  spawn(runId, work) {
    const controller = new AbortController();
    const task = { controller, done: false, promise: null };
    task.promise = work(controller.signal).catch((err) => log.error(`run ${runId} crashed`, err)).finally(() => {
      task.done = true;
    });
    this.tasks.set(runId, task);
  }

  startLive(incident) {
    const runId = this.newId();
    this.store.createRun({
      id: runId, source: incident.source, incident_id: incident.id, title: incident.title || "Untitled incident",
      status: "queued", mode: "live", incident: incident.public(),
    });
    this.live.add(runId);
    this.spawn(runId, (signal) => this.execute(runId, incident, signal));
    return runId;
  }

  startReplay(incident, recording) {
    const runId = this.newId();
    this.store.createRun({
      id: runId, source: incident.source, incident_id: incident.id, title: incident.title, status: "queued",
      mode: "replay", incident: incident.public(),
    });
    this.spawn(runId, (signal) => this.replay(runId, incident, recording, signal));
    return runId;
  }

  cancel(runId) {
    const task = this.tasks.get(runId);
    if (!task || task.done) return false;
    task.controller.abort(new CancelledError("Run cancelled."));
    return true;
  }

  cancelAll() {
    for (const task of this.tasks.values()) if (!task.done) task.controller.abort(new CancelledError());
  }

  async wait(runId) {
    await this.tasks.get(runId)?.promise;
  }

  // -- live ---------------------------------------------------------------------------
  async execute(runId, incident, signal) {
    const started = performance.now();
    const emit = (type, payload) => this.bus.publish(runId, type, payload);
    const onCall = async (call) => {
      this.store.addModelCall(runId, call);
      const { run_id: _ignored, ...rest } = call;
      void _ignored;
      emit("model_call", rest);
    };
    const llm = this.router.session(runId, onCall, signal);
    let status = "failed";
    let error = null;
    let result = null;
    try {
      this.store.updateRun(runId, { status: "running" });
      emit("run_started", {
        title: incident.title || "Untitled incident", source: incident.source, mode: "live", incident: incident.public(),
        sandbox: this.sandbox.name,
      });
      const target = this.settings.resolve(this.settings.targetRepoPath);
      const workspaces = this.settings.resolve(this.settings.workspacesDir);
      fs.mkdirSync(workspaces, { recursive: true });
      const ws = Workspace.create(target, path.join(workspaces, runId), this.sandbox,
        [incident.stack_trace, incident.logs].filter(Boolean).join("\n"));
      const github = this.githubFactory ? this.githubFactory() : null;
      const orch = new Orchestrator({
        runId, incident, settings: this.settings, llm, workspace: ws, bus: this.bus, github, signal,
        onStage: (stage) => this.store.updateRun(runId, { stage }),
      });
      result = await orch.run();
      status = "succeeded";
      if (incident.title !== orch.incident.title) this.store.updateRun(runId, { title: orch.incident.title });
    } catch (err) {
      if (isCancelled(err, signal)) {
        status = "cancelled";
        error = "Run cancelled.";
        emit("error", { message: error, fatal: true, code: "cancelled" });
      } else if (err instanceof BudgetExceeded) {
        error = `Stopped: ${err.message}. Raise MAX_TOKENS_PER_RUN to allow longer investigations.`;
        emit("error", { message: error, fatal: true, code: "budget_exceeded" });
      } else if (err instanceof RunFailed) {
        error = err.message;
        emit("error", { message: error, fatal: true, code: err.code });
      } else if (err instanceof LLMError) {
        error = `Model call failed: ${err.message}`;
        emit("error", { message: error, fatal: true, code: "llm_error" });
      } else {
        log.error(`run ${runId} crashed`, err);
        error = `Internal error: ${err?.name ?? "Error"}`;
        emit("error", { message: error, fatal: true, code: "internal" });
      }
    } finally {
      this.live.delete(runId);
      const duration = Math.round(performance.now() - started);
      const prUrl = result?.pr_url ?? null;
      emit("run_completed", { status, duration_ms: duration, tokens: llm.tokensUsed, pr_url: prUrl });
      this.store.updateRun(runId, {
        status, finished_at: Date.now() / 1000, error, result, tokens: llm.tokensUsed,
        model_calls: llm.budget.calls.length, pr_url: prUrl,
      });
    }
  }

  // -- replay -------------------------------------------------------------------------
  async replay(runId, incident, recording, signal) {
    const state = { tokens: 0, calls: 0, result: null, final: null };
    const started = performance.now();
    const publish = async (type, payload) => {
      if (type === "run_started") Object.assign(payload, { mode: "replay", source: incident.source, scripted: Boolean(recording.scripted) });
      if (type === "run_completed") {
        payload.duration_ms = Math.round(performance.now() - started);
        payload.pr_url = null;
        state.final = payload.status;
      }
      if (type === "model_call") {
        this.store.addModelCall(runId, payload, true);
        state.tokens += payload.prompt_tokens + payload.completion_tokens;
        state.calls += 1;
      }
      if (type === "stage_changed") this.store.updateRun(runId, { stage: payload.stage });
      if (type === "report_ready") {
        const { title, markdown, diff, pr_title, test_path, test_content } = payload;
        state.result = { title, markdown, diff, pr_title, test_path, test_content, pr_url: null };
      }
      this.bus.publish(runId, type, payload);
    };

    let status = "failed";
    try {
      this.store.updateRun(runId, { status: "running" });
      await play(recording, publish, this.settings.replaySpeed, signal);
      status = state.final ?? "succeeded";
    } catch (err) {
      if (!isCancelled(err, signal)) throw err;
      status = "cancelled";
      this.bus.publish(runId, "error", { message: "Replay cancelled.", fatal: true, code: "cancelled" });
      this.bus.publish(runId, "run_completed", {
        status: "cancelled", tokens: state.tokens, duration_ms: Math.round(performance.now() - started),
      });
    } finally {
      this.store.updateRun(runId, {
        status, finished_at: Date.now() / 1000, result: state.result, tokens: state.tokens, model_calls: state.calls,
      });
    }
  }
}

export function cleanupWorkspaces(directory, maxAgeSeconds = 24 * 3600) {
  if (!fs.existsSync(directory)) return 0;
  let removed = 0;
  const cutoff = Date.now() - maxAgeSeconds * 1000;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    try {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory() && fs.statSync(full).mtimeMs < cutoff) {
        fs.rmSync(full, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      /* ignore */
    }
  }
  return removed;
}
