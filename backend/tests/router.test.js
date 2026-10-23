import assert from "node:assert/strict";
import { test } from "node:test";

import { makeSettings } from "../src/config.js";
import { FakeAPIError, FakeLLMClient } from "../src/llm/fake.js";
import { BudgetExceeded, LLMError, LLMOutputError, ModelRouter, TASK_TIERS, extractJson, stripReasoning } from "../src/llm/router.js";
import { HypothesisList, PrTitle } from "../src/llm/schemas.js";

const SETTINGS = makeSettings({
  nemotronNanoModel: "nano-m", nemotronSuperModel: "super-m", nemotronUltraModel: "ultra-m", maxTokensPerRun: 100_000,
}, { env: {} });

function make(responder, settings = SETTINGS) {
  const client = new FakeLLMClient(responder);
  const calls = [];
  const router = new ModelRouter(settings, { client, backoffBase: 0 });
  return { llm: router.session("run1", async (c) => calls.push(c)), client, calls };
}

const ask = (llm, task = "pr_title", schema = PrTitle, fmt = {}) => llm.ask({ stage: "report", task, user: "u", schema, fmt });

test("routing table covers three tiers", () => {
  assert.deepEqual(new Set(Object.values(TASK_TIERS)), new Set(["nano", "super", "ultra"]));
  assert.equal(TASK_TIERS.generate_hypotheses, "ultra");
  assert.equal(TASK_TIERS.write_fix, "super");
  assert.equal(TASK_TIERS.classify_failure, "nano");
});

test("parses fenced JSON with a think block", () => {
  const text = '<think>hmm {"no": 1</think>Sure!\n```json\n{"title": "fix: x"}\n```';
  assert.deepEqual(extractJson(text), { title: "fix: x" });
  assert.equal(stripReasoning("abc</think> done"), "done");
  assert.deepEqual(extractJson('noise {"a": {"b": 2}} trailing {'), { a: { b: 2 } });
  assert.deepEqual(extractJson('{"s": "brace } in string"}'), { s: "brace } in string" });
});

test("records telemetry and routes to the task's tier", async () => {
  const { llm, client, calls } = make(() => ({ title: "fix: thing" }));
  assert.equal((await ask(llm)).title, "fix: thing");
  assert.equal(client.calls[0].model, "super-m");
  const c = calls[0];
  assert.deepEqual([c.task, c.tier, c.model, c.success, c.fallback], ["pr_title", "super", "super-m", true, false]);
  assert.ok(c.prompt_tokens > 0 && c.completion_tokens > 0);
  assert.equal(llm.tokensUsed, c.prompt_tokens + c.completion_tokens);
});

test("retries once with the validation error", async () => {
  const replies = ["not json at all", '{"title": "fix: ok"}'];
  const { llm, client } = make(() => replies.shift());
  assert.equal((await ask(llm)).title, "fix: ok");
  assert.equal(client.calls.length, 2);
  assert.match(client.calls[1].messages.at(-1).content, /not valid/);
});

test("gives up after a second parse failure", async () => {
  const { llm } = make(() => '{"wrong": 1}');
  await assert.rejects(ask(llm), LLMOutputError);
});

test("retries on 429/503 then succeeds", async () => {
  const seq = [new FakeAPIError(429), new FakeAPIError(503), '{"title": "fix: y"}'];
  const { llm, client, calls } = make(() => seq.shift());
  assert.equal((await ask(llm)).title, "fix: y");
  assert.deepEqual(calls.map((c) => c.success), [false, false, true]);
  assert.ok(client.calls.every((c) => c.model === "super-m"));
});

test("falls back a tier: ultra -> super", async () => {
  const { llm, client, calls } = make((model) => (model === "ultra-m" ? new FakeAPIError(500)
    : { hypotheses: [{ title: "t", explanation: "e", confidence: 70 }] }));
  const out = await ask(llm, "generate_hypotheses", HypothesisList, { n: 2 });
  assert.ok(Math.abs(out.hypotheses[0].confidence - 0.7) < 1e-9);
  assert.deepEqual(client.calls.map((c) => c.model), ["ultra-m", "ultra-m", "ultra-m", "super-m"]);
  assert.equal(calls.at(-1).fallback, true);
  assert.equal(calls.at(-1).tier, "super");
});

test("non-retryable errors fall back immediately", async () => {
  const { llm, client } = make((model) => (model === "super-m" ? new FakeAPIError(404) : { title: "fix: n" }));
  assert.equal((await ask(llm)).title, "fix: n");
  assert.deepEqual(client.calls.map((c) => c.model), ["super-m", "nano-m"]);
});

test("all tiers fail", async () => {
  const { llm } = make(() => new FakeAPIError(500));
  await assert.rejects(ask(llm, "classify_failure", PrTitle), (err) => err instanceof LLMError && /all tiers failed/.test(err.message));
});

test("token budget stops the run", async () => {
  const { llm } = make(() => ({ title: "fix: z" }), SETTINGS.with({ maxTokensPerRun: 10 }));
  await ask(llm);
  await assert.rejects(ask(llm), BudgetExceeded);
});

test("no client without a key", () => {
  const router = new ModelRouter(makeSettings({ nebiusApiKey: "" }, { env: {} }));
  assert.equal(router.available, false);
});
