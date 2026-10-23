import assert from "node:assert/strict";
import { test } from "node:test";

import { parseReport } from "../src/sandbox/base.js";
import { LocalSandbox } from "../src/sandbox/local.js";
import { demoRepo, tempDir, write } from "./helpers.js";

const HEADER = 'import assert from "node:assert/strict";\nimport { test } from "node:test";\n';

function project() {
  const root = tempDir();
  write(root, "package.json", '{"type": "module"}\n');
  return root;
}

test("counts pass and fail", async () => {
  const root = project();
  write(root, "tests/a.test.js", `${HEADER}test("ok", () => {});\ntest("bad", () => { assert.equal(1, 2, "boom"); });\n`);
  const res = await new LocalSandbox(30).runTests(root);
  assert.deepEqual([res.passed, res.failed, res.errors], [1, 1, 0]);
  assert.notEqual(res.exitCode, 0);
  assert.equal(res.failures[0].nodeid, "tests/a.test.js::bad");
  assert.match(res.failures[0].message, /boom/);
  assert.equal(res.ok, false);
});

test("selector limits the run", async () => {
  const root = project();
  write(root, "tests/a.test.js", `${HEADER}test("ok", () => {});\n`);
  write(root, "tests/b.test.js", `${HEADER}test("bad", () => { assert.fail("no"); });\n`);
  const res = await new LocalSandbox(30).runTests(root, "tests/a.test.js");
  assert.ok(res.ok);
  assert.equal(res.passed, 1);
});

test("an import error is reported as an error, not a failure", async () => {
  const root = project();
  write(root, "tests/a.test.js", `import { nothing } from "./does-not-exist.js";\n${HEADER}test("x", () => {});\n`);
  const res = await new LocalSandbox(30).runTests(root);
  assert.equal(res.errors, 1);
  assert.equal(res.failed, 0);
  assert.match(res.failures[0].message + res.failures[0].details, /does-not-exist/);
});

test("timeout kills the whole process tree", async () => {
  const root = project();
  write(root, "tests/slow.test.js", `${HEADER}import { spawn } from "node:child_process";
test("slow", async () => {
  spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 60000));
});\n`);
  const res = await new LocalSandbox(3).runTests(root);
  assert.equal(res.timedOut, true);
  assert.ok(res.durationMs < 15_000, `took ${res.durationMs} ms`);
  assert.equal(res.ok, false);
});

test("secrets are not visible to code under test", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { NEBIUS_API_KEY: "sk-super-secret", GITHUB_TOKEN: "ghp_secret", WEBHOOK_SECRET: "whsec" });
  try {
    const root = project();
    write(root, "tests/env.test.js", `${HEADER}test("env", () => {
  const leaked = Object.keys(process.env).filter((k) => /KEY|TOKEN|SECRET/i.test(k));
  assert.deepEqual(leaked, []);
  assert.equal(process.cwd(), process.env.HOME);
});\n`);
    const res = await new LocalSandbox(30).runTests(root);
    assert.ok(res.ok, res.outputTail);
  } finally {
    for (const k of ["NEBIUS_API_KEY", "GITHUB_TOKEN", "WEBHOOK_SECRET"]) {
      if (k in saved) process.env[k] = saved[k];
      else delete process.env[k];
    }
  }
});

test("parseReport counts", () => {
  const lines = [
    { status: "passed", file: "tests/x.test.js", name: "a", nesting: 0 },
    { status: "failed", file: "tests/x.test.js", name: "b", nesting: 0, error_name: "AssertionError", message: "x", stack: "tb" },
    { status: "skipped", file: "tests/x.test.js", name: "c", nesting: 0 },
  ].map((l) => JSON.stringify(l)).join("\n");
  const out = parseReport(lines);
  assert.deepEqual([out.passed, out.failed, out.skipped], [1, 1, 1]);
  assert.equal(out.failures[0].nodeid, "tests/x.test.js::b");
  assert.equal(out.failures[0].message, "AssertionError: x");
});

test("the demo-shop suite passes", async () => {
  const res = await new LocalSandbox(60).runTests(demoRepo());
  assert.ok(res.ok, res.outputTail);
  assert.equal(res.passed, 30);
});
