/** End-to-end orchestrator tests: scripted fake LLM + the real local sandbox against demo-shop. */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { EventBus } from "../src/agent/events.js";
import { demoIncident, incidentFromDemo } from "../src/agent/incident.js";
import { RunManager } from "../src/agent/runs.js";
import { ScriptedLLM } from "../src/llm/fake.js";
import { ModelRouter } from "../src/llm/router.js";
import { SCRIPTS } from "../src/replay/scripted.js";
import { LocalSandbox } from "../src/sandbox/local.js";
import { Store } from "../src/storage/db.js";
import { settingsFor, tempDir } from "./helpers.js";

async function runBug(incidentId, script, overrides = {}) {
  const settings = settingsFor(tempDir(), { maxFixAttempts: 3, maxHypotheses: 4, ...overrides });
  const store = new Store(settings.databaseUrl);
  const bus = new EventBus((e) => store.addEvent(e));
  const client = new ScriptedLLM(script);
  const router = new ModelRouter(settings, { client, backoffBase: 0 });
  const manager = new RunManager(settings, store, bus, router, { sandbox: new LocalSandbox(60) });
  const incidentsDir = path.join(settings.demoShopSource, "incidents");
  const runId = manager.startLive(incidentFromDemo(demoIncident(incidentsDir, incidentId)));
  await manager.wait(runId);
  return { runId, events: store.events(runId), run: store.getRun(runId), client, store };
}

const types = (events) => events.map((e) => e.type);
const first = (events, type, match = {}) =>
  events.findIndex((e) => e.type === type && Object.entries(match).every(([k, v]) => e.payload[k] === v));
const debug = (events) => JSON.stringify(events.filter((e) => ["error", "log"].includes(e.type)).map((e) => e.payload.message));
const clone = (v) => structuredClone(v);

test("bug 4: rejects the misleading hypothesis, then confirms and fixes", async () => {
  const { events, run, store } = await runBug("bug-4-misleading-inventory", SCRIPTS["bug-4-misleading-inventory"]);
  const ts = types(events);
  assert.equal(run.status, "succeeded", debug(events));
  assert.equal(ts[0], "run_started");
  assert.equal(ts.at(-1), "run_completed");

  const stages = events.filter((e) => e.type === "stage_changed").map((e) => e.payload.stage);
  assert.deepEqual(stages, ["trigger", "investigate", "reproduce", "fix", "verify", "report"]);

  const rejected = first(events, "hypothesis_rejected", { id: "h1" });
  const confirmed = first(events, "hypothesis_confirmed", { id: "h2" });
  assert.ok(rejected >= 0 && confirmed >= 0 && rejected < confirmed);
  // the core rule: no application edit before a failing reproduction test confirmed a hypothesis
  assert.ok(first(events, "patch_applied") > confirmed);
  assert.ok(first(events, "patch_proposed") > confirmed);
  const repro = events.filter((e) => e.type === "test_run_finished" && e.payload.purpose === "reproduce").map((e) => e.payload);
  assert.equal(repro[0].failed, 0); // h1's test passed -> rejected
  assert.equal(repro[0].passed, 2);
  assert.ok(repro[1].failed >= 1); // h2's test failed -> confirmed

  const suite = events.filter((e) => e.type === "test_run_finished" && e.payload.purpose === "verify_suite").at(-1).payload;
  assert.deepEqual([suite.failed, suite.errors, suite.passed], [0, 0, 32]);

  const report = events.find((e) => e.type === "report_ready").payload;
  assert.ok(report.diff.includes("+      this._lines.set(item.sku, item.copy());"));
  assert.ok(report.diff.includes("b/tests/fixsi/buy-again-does-not-mutate-order.test.js"));
  assert.ok(!report.diff.includes("inventory-release-bookkeeping")); // rejected test removed
  assert.ok(!/a\/tests\/(?!fixsi)/.test(report.diff)); // pre-existing tests untouched
  for (const heading of ["Summary", "Impact", "Root cause", "Evidence", "Fix", "How it was verified", "Prevention"]) {
    assert.ok(report.markdown.includes(`## ${heading}`), heading);
  }
  assert.ok(report.markdown.includes("Ruled out"));
  assert.equal(run.result.diff, report.diff);

  const calls = events.filter((e) => e.type === "model_call").map((e) => e.payload);
  assert.deepEqual(new Set(calls.map((c) => c.tier)), new Set(["nano", "super", "ultra"]));
  assert.equal(run.tokens, calls.reduce((n, c) => n + c.prompt_tokens + c.completion_tokens, 0));
  assert.ok(store.stats().tiers.reduce((n, t) => n + t.calls, 0) >= calls.length);
});

for (const bug of ["bug-1-missing-address", "bug-2-bulk-threshold", "bug-3-rounding-regression"]) {
  test(`${bug} end to end`, async () => {
    const { events, run } = await runBug(bug, SCRIPTS[bug]);
    assert.equal(run.status, "succeeded", debug(events));
    assert.ok(first(events, "patch_applied") > first(events, "hypothesis_confirmed"));
  });
}

test("bug 1 retries after a failed fix attempt", async () => {
  const { events, run, client } = await runBug("bug-1-missing-address", SCRIPTS["bug-1-missing-address"]);
  assert.deepEqual(events.filter((e) => e.type === "patch_applied").map((e) => e.payload.attempt), [1, 2]);
  assert.equal(client.count("diagnose_fix_failure"), 1);
  assert.ok(run.result.diff.includes("throw new CheckoutError"));
});

test("no code edits when nothing reproduces", async () => {
  const script = clone(SCRIPTS["bug-4-misleading-inventory"]);
  script.write_repro_test = [script.write_repro_test[0]]; // every hypothesis gets a test that passes
  const { events, run, client } = await runBug("bug-4-misleading-inventory", script);
  assert.equal(run.status, "failed");
  assert.ok(!types(events).includes("patch_applied") && !types(events).includes("patch_proposed"));
  assert.equal(client.count("write_fix"), 0);
  assert.equal(client.count("generate_hypotheses"), 2); // re-investigated once
  assert.equal(events.find((e) => e.type === "error").payload.code, "not_reproduced");
});

test("a patch touching existing tests is rejected", async () => {
  const script = clone(SCRIPTS["bug-2-bulk-threshold"]);
  const cheat = { explanation: "make the test happy",
    edits: [{ path: "tests/pricing.test.js", search: 'test("no bulk discount on small order"', replace: 'test.skip("x"' }] };
  script.write_fix = [cheat, cheat, SCRIPTS["bug-2-bulk-threshold"].write_fix[0]];
  const { events, run } = await runBug("bug-2-bulk-threshold", script);
  assert.equal(run.status, "succeeded", debug(events));
  const logs = events.filter((e) => e.type === "log").map((e) => e.payload.message);
  assert.equal(logs.filter((m) => m.includes("pre-existing tests is not allowed")).length, 2);
  assert.ok(!run.result.diff.includes("tests/pricing.test.js"));
});

test("an exhausted token budget stops gracefully", async () => {
  const { events, run } = await runBug("bug-2-bulk-threshold", SCRIPTS["bug-2-bulk-threshold"], { maxTokensPerRun: 500 });
  assert.equal(run.status, "failed");
  assert.equal(events.find((e) => e.type === "error").payload.code, "budget_exceeded");
  assert.equal(types(events).at(-1), "run_completed");
});
