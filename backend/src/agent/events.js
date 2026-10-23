/** Typed SSE events and the per-run event bus. */

import { z } from "zod";

import { AsyncQueue } from "../util.js";

export const STAGES = ["trigger", "investigate", "reproduce", "fix", "verify", "report"];

const str = z.string();
const num = z.number();
const nullable = (t) => t.nullable().default(null);
const list = (t) => z.array(t).default([]);
const record = z.record(z.string(), z.any());

const TestRunStarted = z.object({
  purpose: z.enum(["baseline", "reproduce", "verify_repro", "verify_suite"]),
  selector: nullable(str),
  hypothesis_id: nullable(str),
  attempt: nullable(num),
});

const HypothesisVerdict = z.object({ id: str, reason: str, test_path: nullable(str) });

export const PAYLOADS = {
  run_started: z.object({
    title: str,
    source: str,
    mode: z.enum(["live", "replay"]),
    incident: record,
    sandbox: str.default("local"),
    scripted: z.boolean().default(false),
  }),
  stage_changed: z.object({ stage: z.enum(STAGES) }),
  log: z.object({ message: str, level: z.enum(["info", "warn", "success", "error"]).default("info") }),
  hypothesis_created: z.object({
    id: str,
    rank: num,
    round: num.default(1),
    title: str,
    explanation: str,
    suspected_files: list(str),
    confidence: num,
    evidence_for: list(str),
    evidence_against: list(str),
  }),
  evidence_added: z.object({ hypothesis_id: str, kind: z.enum(["for", "against"]), text: str }),
  hypothesis_rejected: HypothesisVerdict,
  hypothesis_confirmed: HypothesisVerdict,
  test_written: z.object({
    hypothesis_id: str,
    path: str,
    content: str,
    expected_failure: str.default(""),
    repaired: z.boolean().default(false),
  }),
  test_run_started: TestRunStarted,
  test_run_finished: TestRunStarted.extend({
    passed: num,
    failed: num,
    errors: num,
    duration_ms: num,
    exit_code: num,
    timed_out: z.boolean().default(false),
    backend: str.default("local"),
    output_tail: str.default(""),
    failures: list(record),
  }),
  patch_proposed: z.object({ attempt: num, explanation: str, edits: z.array(record) }),
  patch_applied: z.object({ attempt: num, files: z.array(str), diff: str }),
  model_call: z.object({
    stage: str,
    task: str,
    tier: z.enum(["nano", "super", "ultra"]),
    model: str,
    prompt_tokens: num,
    completion_tokens: num,
    latency_ms: num,
    success: z.boolean(),
    fallback: z.boolean().default(false),
    error: nullable(str),
  }),
  pr_opened: z.object({ url: str, number: nullable(num), branch: str }),
  report_ready: z.object({
    title: str,
    markdown: str,
    postmortem: record,
    diff: str,
    test_path: str,
    test_content: str,
    pr_title: str,
    models: list(str),
  }),
  run_completed: z.object({
    status: z.enum(["succeeded", "failed", "cancelled"]),
    duration_ms: num,
    tokens: num,
    pr_url: nullable(str),
  }),
  error: z.object({ message: str, fatal: z.boolean().default(true), code: nullable(str) }),
};

/** Validate a payload against its event type; fills defaults and drops unknown keys. */
export function makePayload(type, payload) {
  const schema = PAYLOADS[type];
  if (!schema) throw new Error(`unknown event type: ${type}`);
  return schema.parse(payload);
}

/** In-memory fan-out of live events. History is served from storage. */
export class EventBus {
  constructor(persist = null) {
    this.persist = persist;
    this.seq = new Map();
    this.subs = new Map();
  }

  seed(runId, lastId) {
    this.seq.set(runId, Math.max(this.seq.get(runId) ?? 0, lastId));
  }

  publish(runId, type, payload, timestamp = null) {
    const id = (this.seq.get(runId) ?? 0) + 1;
    this.seq.set(runId, id);
    const event = { id, run_id: runId, type, timestamp: timestamp ?? Date.now() / 1000, payload: makePayload(type, payload) };
    this.persist?.(event);
    for (const q of this.subs.get(runId) ?? []) q.put(event);
    return event;
  }

  subscribe(runId) {
    const q = new AsyncQueue();
    if (!this.subs.has(runId)) this.subs.set(runId, new Set());
    this.subs.get(runId).add(q);
    return q;
  }

  unsubscribe(runId, q) {
    const set = this.subs.get(runId);
    set?.delete(q);
    if (set && set.size === 0) this.subs.delete(runId);
  }
}
