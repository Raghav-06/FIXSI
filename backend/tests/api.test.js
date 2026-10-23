import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createApp } from "../src/app.js";
import { ScriptedLLM } from "../src/llm/fake.js";
import { SCRIPTS } from "../src/replay/scripted.js";
import { RateLimiter, sign, verifySignature } from "../src/security.js";
import { settingsFor, tempDir } from "./helpers.js";

const SECRET = "test-webhook-secret-0123456789abcdef";
const servers = [];

after(async () => {
  for (const { server, app } of servers) {
    app.locals.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

/** Start an app on a random port; returns a tiny client. */
async function start(overrides = {}, options = {}) {
  const settings = settingsFor(tempDir(), { webhookSecret: SECRET, replaySpeed: 200, ...overrides });
  const app = createApp({ settings, ...options });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  servers.push({ server, app });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { json, body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method, headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json ? JSON.stringify(json) : body,
    });
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, headers: res.headers, data, text };
  };
  return {
    app,
    get: (p, o) => call("GET", p, o),
    post: (p, o) => call("POST", p, o),
    /** Read an SSE stream to its end; returns the parsed events. */
    async stream(p, headers = {}) {
      const res = await fetch(base + p, { headers });
      const text = await res.text();
      return text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    },
    async waitDone(runId, timeoutMs = 120_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const run = (await call("GET", `/api/runs/${runId}`)).data;
        if (["succeeded", "failed", "cancelled"].includes(run.status)) return run;
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error("run did not finish");
    },
  };
}

test("health reports replay mode without a key", async () => {
  const c = await start();
  const h = (await c.get("/api/health")).data;
  assert.equal(h.mode, "replay");
  assert.equal(h.llm.configured, false);
  assert.equal(h.github.configured, false);
  assert.equal(h.replays.length, 4);
  assert.ok(!JSON.stringify(h).includes(SECRET));
});

test("incidents are listed without trigger code", async () => {
  const c = await start();
  const items = (await c.get("/api/incidents")).data;
  assert.deepEqual(items.map((i) => i.number), [1, 2, 3, 4]);
  assert.ok(items.every((i) => !("trigger" in i) && i.has_replay));
});

for (const incident of ["bug-1-missing-address", "bug-2-bulk-threshold", "bug-3-rounding-regression", "bug-4-misleading-inventory"]) {
  test(`replay plays back fully and streams: ${incident}`, async () => {
    const c = await start();
    const r = await c.post("/api/runs", { json: { source: "demo", incident_id: incident } });
    assert.equal(r.status, 201);
    assert.equal(r.data.mode, "replay");
    const runId = r.data.run_id;
    const events = await c.stream(`/api/runs/${runId}/events`);
    assert.equal(events[0].type, "run_started");
    assert.equal(events[0].payload.mode, "replay");
    assert.equal(events.at(-1).type, "run_completed");
    assert.equal(events.at(-1).payload.status, "succeeded");
    assert.deepEqual(events.map((e) => e.id), events.map((_, i) => i + 1));
    const run = await c.waitDone(runId);
    assert.equal(run.mode, "replay");
    assert.equal(run.status, "succeeded");
    const patch = await c.get(`/api/runs/${runId}/patch`);
    assert.equal(patch.status, 200);
    assert.ok(patch.text.startsWith("diff --git"));
    assert.match(patch.headers.get("content-disposition"), /attachment/);
    // a late join with Last-Event-ID only gets the rest
    const later = await c.stream(`/api/runs/${runId}/events`, { "Last-Event-ID": "5" });
    assert.equal(later[0].id, 6);
    assert.equal(later.at(-1).type, "run_completed");
    const stats = (await c.get("/api/stats")).data;
    assert.deepEqual(new Set(stats.tiers.filter((t) => t.calls).map((t) => t.tier)), new Set(["nano", "super", "ultra"]));
  });
}

test("paste requires live mode", async () => {
  const c = await start();
  const r = await c.post("/api/runs", { json: { source: "paste", error_text: "boom" } });
  assert.equal(r.status, 503);
  assert.match(r.data.detail, /live mode/);
});

test("input size limit", async () => {
  const c = await start();
  assert.equal((await c.post("/api/runs", { json: { source: "paste", error_text: "x".repeat(60_000) } })).status, 413);
});

test("unknown run and incident", async () => {
  const c = await start();
  assert.equal((await c.get("/api/runs/nope")).status, 404);
  assert.equal((await c.post("/api/runs", { json: { source: "demo", incident_id: "zzz" } })).status, 404);
  assert.equal((await c.post("/api/runs", { json: { source: "nope" } })).status, 422);
});

test("webhook signature is required", async () => {
  const c = await start();
  const body = JSON.stringify({ error: "TypeError: x", incident_id: "bug-1-missing-address" });
  const post = (b, sig) => c.post("/api/webhooks/error", {
    body: b, headers: { "Content-Type": "application/json", ...(sig ? { "X-Fixsi-Signature": sig } : {}) },
  });
  assert.equal((await post(body)).status, 401);
  assert.equal((await post(body, "sha256=" + "0".repeat(64))).status, 401);
  assert.equal((await post(body + " ", sign(SECRET, Buffer.from(body)))).status, 401);
  const ok = await post(body, sign(SECRET, Buffer.from(body)));
  assert.equal(ok.status, 202);
  const run = await c.waitDone(ok.data.run_id);
  assert.equal(run.source, "webhook");
});

test("Break it triggers the real bug and a signed webhook", async () => {
  const c = await start();
  const r = await c.post("/api/demo-shop/break/bug-1-missing-address");
  assert.equal(r.status, 202, r.text);
  assert.match(r.data.captured_error, /TypeError/);
  const run = await c.waitDone(r.data.run_id);
  assert.equal(run.source, "webhook");
  assert.match(run.incident.stack_trace, /at OrderService\.checkout/);
  assert.match(run.incident.stack_trace, /orders\.js/);
});

test("placeholder or short webhook secret disables webhooks", async () => {
  for (const webhookSecret of ["change-me-to-a-long-random-string", "too-short"]) {
    const c = await start({ webhookSecret });
    assert.equal((await c.get("/api/health")).data.webhooks, false);
    const body = JSON.stringify({ error: "TypeError: x", incident_id: "bug-1-missing-address" });
    const r = await c.post("/api/webhooks/error", {
      body, headers: { "Content-Type": "application/json", "X-Fixsi-Signature": sign(webhookSecret, Buffer.from(body)) },
    });
    assert.equal(r.status, 503);
    assert.equal((await c.post("/api/demo-shop/break/bug-1-missing-address")).status, 503);
  }
  assert.equal((await (await start()).get("/api/health")).data.webhooks, true);
});

test("verifySignature helper", () => {
  const body = Buffer.from('{"a":1}');
  assert.ok(verifySignature("s", body, sign("s", body)));
  assert.ok(!verifySignature("s", body, sign("t", body)));
  assert.ok(!verifySignature("", body, sign("", body)));
  assert.ok(!verifySignature("s", body, null));
});

test("rate limiter sliding window", () => {
  let now = 0;
  const rl = new RateLimiter(2, 3600, () => now);
  rl.hit("ip");
  rl.hit("ip");
  assert.deepEqual(rl.check("ip"), [false, 3600]);
  assert.ok(rl.check("other")[0]);
  now = 3601;
  assert.ok(rl.check("ip")[0]);
});

test("live run and per-IP rate limit", async () => {
  const c = await start({ nebiusApiKey: "test-key", rateLimitRunsPerHour: 2, maxConcurrentRuns: 5 },
    { llmClient: new ScriptedLLM(SCRIPTS["bug-2-bulk-threshold"]) });
  assert.equal((await c.get("/api/health")).data.mode, "live");
  const r1 = await c.post("/api/runs", { json: { source: "demo", incident_id: "bug-2-bulk-threshold" } });
  assert.equal(r1.status, 201);
  assert.equal(r1.data.mode, "live");
  const run = await c.waitDone(r1.data.run_id);
  assert.equal(run.status, "succeeded", run.error);
  assert.ok(run.tokens > 0 && run.model_calls > 0);
  assert.equal((await c.post("/api/runs", { json: { source: "paste", error_text: "TypeError in checkout" } })).status, 201);
  const r3 = await c.post("/api/runs", { json: { source: "demo", incident_id: "bug-2-bulk-threshold" } });
  assert.equal(r3.status, 429);
  assert.equal(r3.data.code, "rate_limited");
  assert.ok(r3.headers.get("retry-after"));
});

test("concurrency cap and cancel", async () => {
  const c = await start({ nebiusApiKey: "k", maxConcurrentRuns: 1, rateLimitRunsPerHour: 99 },
    { llmClient: new ScriptedLLM(SCRIPTS["bug-2-bulk-threshold"]) });
  const firstRun = await c.post("/api/runs", { json: { source: "demo", incident_id: "bug-2-bulk-threshold" } });
  assert.equal(firstRun.status, 201);
  const second = await c.post("/api/runs", { json: { source: "demo", incident_id: "bug-2-bulk-threshold" } });
  assert.equal(second.status, 429);
  assert.match(second.data.detail, /busy/);
  assert.equal((await c.post(`/api/runs/${firstRun.data.run_id}/cancel`)).status, 200);
  assert.equal((await c.waitDone(firstRun.data.run_id)).status, "cancelled");
});

function githubMock() {
  const calls = [];
  const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status });
  const fetchImpl = async (url, init) => {
    const { pathname } = new URL(url);
    const method = init.method ?? "GET";
    calls.push({ method, path: pathname, body: init.body });
    if (pathname.endsWith("/issues/7")) return json(200, { title: "Bulk discount missing at 10", body: "Buying 10 pens shows no savings." });
    if (pathname.endsWith("/issues/7/comments")) return json(200, []);
    if (pathname.includes("/git/ref/heads/main")) return json(200, { object: { sha: "abc123" } });
    if (pathname.endsWith("/git/refs")) return json(201, {});
    if (pathname.includes("/contents/") && method === "GET") return pathname.includes("shop/") ? json(200, { sha: "oldsha" }) : json(404);
    if (pathname.includes("/contents/") && method === "PUT") return json(201, {});
    if (pathname.endsWith("/pulls")) return json(201, { html_url: "https://github.com/me/demo-shop/pull/3", number: 3 });
    return json(404);
  };
  return { fetchImpl, calls };
}

test("a GitHub issue run opens a PR", async () => {
  const { fetchImpl, calls } = githubMock();
  const c = await start({ nebiusApiKey: "k", githubToken: "ghp_x", githubRepoOwner: "me", githubRepoName: "demo-shop" },
    { llmClient: new ScriptedLLM(SCRIPTS["bug-2-bulk-threshold"]), githubFetch: fetchImpl });
  assert.equal((await c.get("/api/health")).data.github.configured, true);
  const bad = await c.post("/api/runs", { json: { source: "github_issue", issue_url: "https://github.com/evil/x/issues/7" } });
  assert.equal(bad.status, 400);
  const r = await c.post("/api/runs", { json: { source: "github_issue", issue_url: "https://github.com/me/demo-shop/issues/7" } });
  assert.equal(r.status, 201, r.text);
  const run = await c.waitDone(r.data.run_id);
  assert.equal(run.status, "succeeded", run.error);
  assert.equal(run.pr_url, "https://github.com/me/demo-shop/pull/3");
  assert.equal(run.title, "Bulk discount missing at 10");
  assert.ok(run.events.some((e) => e.type === "pr_opened"));
  const paths = calls.map((x) => `${x.method} ${x.path}`);
  assert.ok(paths.includes("POST /repos/me/demo-shop/git/refs"));
  assert.ok(paths.includes("PUT /repos/me/demo-shop/contents/shop/promotions.js"));
  assert.ok(paths.includes("PUT /repos/me/demo-shop/contents/tests/fixsi/bulk-threshold.test.js"));
  const prBody = JSON.parse(calls.find((x) => x.path.endsWith("/pulls")).body);
  assert.ok(prBody.head.startsWith("fixsi/"));
  assert.ok(prBody.title.startsWith("fix:"));
  assert.ok(prBody.body.includes("Generated by Fixsi"));
});
