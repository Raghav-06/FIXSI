/** Serverless Jobs sandbox: real job flow against a fake `nebius` CLI, plus automatic local fallback. */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { makeSettings } from "../src/config.js";
import { LocalSandbox } from "../src/sandbox/local.js";
import { NebiusJobsSandbox, findState, parseJobLogs } from "../src/sandbox/nebiusJobs.js";
import { demoRepo, tempDir, write } from "./helpers.js";

/**
 * Fake `nebius ai job ...` (run with node). `create` unpacks the injected archive and runs the node --test
 * command from the injected run.sh locally, writing the same marker-delimited log a real job would.
 */
const FAKE_CLI = `
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const state = process.env.FAKE_NEBIUS_STATE;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(state, "calls.jsonl"), JSON.stringify(args) + "\\n");
const [a, b, cmd] = args;
if (cmd === "create") {
  const inject = {};
  args.forEach((x, i) => { if (args[i - 1] === "--inject-file") { const j = x.lastIndexOf(":/fixsi/"); inject[x.slice(j + 1)] = x.slice(0, j); } });
  const job = "aijob-" + Math.random().toString(16).slice(2, 10);
  const root = fs.mkdtempSync(path.join(state, "job-"));
  const w = path.join(root, "w");
  fs.mkdirSync(w);
  // relative archive path: GNU tar reads "C:\\..." as a remote host
  fs.copyFileSync(inject["/fixsi/ws.tgz"], path.join(w, "ws.tgz"));
  execFileSync("tar", ["xzf", "ws.tgz"], { cwd: w });
  fs.unlinkSync(path.join(w, "ws.tgz"));
  const script = fs.readFileSync(inject["/fixsi/run.sh"], "utf8");
  const line = script.split("\\n").find((l) => l.includes(" --test "));
  const report = path.join(root, "report.jsonl");
  const nodeArgs = line.replace(/^NO_COLOR=1 node /, "").split(" ")
    .map((x) => x === "/fixsi/reporter.mjs" ? new URL("file:///" + inject["/fixsi/reporter.mjs"].replace(/\\\\/g, "/").replace(/^\\//, "")).href : x)
    .map((x) => x === "/tmp/report.jsonl" ? report : x);
  const out = spawnSync(process.execPath, nodeArgs, { cwd: w, encoding: "utf8", env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT ?? "" } });
  const b64 = fs.existsSync(report) ? fs.readFileSync(report).toString("base64") : "";
  fs.writeFileSync(path.join(state, job + ".log"), out.stdout + out.stderr + "<<<FIXSI_REPORT\\n" + b64 + "\\nFIXSI_REPORT>>>\\nFIXSI_EXIT=" + out.status + "\\n");
  console.log(job);
} else if (cmd === "get") {
  console.log(JSON.stringify({ metadata: { id: args[3] }, status: { state: "COMPLETED" } }));
} else if (cmd === "logs") {
  process.stdout.write(fs.readFileSync(path.join(state, args[3] + ".log"), "utf8"));
} else {
  console.log("ok");
}
`;

function fakeCli() {
  const dir = tempDir("fixsi-cli-");
  const cli = path.join(dir, "nebius.mjs");
  fs.writeFileSync(cli, FAKE_CLI);
  const state = path.join(dir, "state");
  fs.mkdirSync(state);
  process.env.FAKE_NEBIUS_STATE = state;
  return { cli, state };
}

function make(cli = "nebius-does-not-exist", project = "project-e00test") {
  const s = makeSettings({ sandboxMode: "nebius_jobs", nebiusCliPath: cli, nebiusJobsProjectId: project }, { env: {} });
  return new NebiusJobsSandbox(s, new LocalSandbox(60), 0.01);
}

test("runs tests as a job", async () => {
  const { cli, state } = fakeCli();
  const res = await make(cli).runTests(demoRepo(), "tests/cart.test.js");
  assert.equal(res.backend, "nebius_jobs", res.outputTail);
  assert.ok(res.ok, res.outputTail);
  assert.equal(res.passed, 5);
  const calls = fs.readFileSync(path.join(state, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const create = calls[0];
  assert.deepEqual(create.slice(0, 3), ["ai", "job", "create"]);
  assert.equal(create[create.indexOf("--parent-id") + 1], "project-e00test");
  assert.equal(create[create.indexOf("--image") + 1], "node:22-slim");
  assert.deepEqual(calls.map((c) => c[2]), ["create", "get", "logs"]);
});

test("failures are parsed from job logs", async () => {
  const { cli } = fakeCli();
  const ws = path.join(tempDir(), "ws");
  fs.cpSync(demoRepo(), ws, { recursive: true });
  write(ws, "tests/fixsi/x.test.js", 'import assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("x", () => { assert.equal(1, 2); });\n');
  const res = await make(cli).runTests(ws, "tests/fixsi/x.test.js");
  assert.equal(res.backend, "nebius_jobs");
  assert.equal(res.failed, 1);
  assert.notEqual(res.exitCode, 0);
});

test("falls back to local when unconfigured", async () => {
  const sb = make(undefined, "");
  assert.match(sb.unavailableReason(), /NEBIUS_JOBS_PROJECT_ID/);
  const res = await sb.runTests(demoRepo(), "tests/cart.test.js");
  assert.ok(res.ok);
  assert.equal(res.backend, "local (jobs fallback)");
});

test("falls back when the CLI is missing", async () => {
  const res = await make().runTests(demoRepo(), "tests/cart.test.js");
  assert.ok(res.ok);
  assert.equal(res.backend, "local (jobs fallback)");
});

test("falls back when the job fails", async () => {
  const broken = path.join(tempDir(), "nebius.mjs");
  fs.writeFileSync(broken, 'console.error("quota exceeded"); process.exit(3);\n');
  const res = await make(broken).runTests(demoRepo(), "tests/cart.test.js");
  assert.ok(res.ok);
  assert.equal(res.backend, "local (jobs fallback)");
  assert.match(res.outputTail, /job failed/);
});

test("log and state parsing", () => {
  const report = JSON.stringify({ status: "passed", file: "tests/a.test.js", name: "ok", nesting: 0 });
  const logs = `1 passed\n<<<FIXSI_REPORT\n${Buffer.from(report).toString("base64")}\nFIXSI_REPORT>>>\nFIXSI_EXIT=0\n`;
  const [code, parsed, output] = parseJobLogs(logs);
  assert.equal(code, 0);
  assert.equal(parsed, report);
  assert.equal(output.trim(), "1 passed");
  assert.equal(findState({ status: { state: "Running" } }), "RUNNING");
  assert.equal(findState([{ x: { phase: "completed" } }]), "COMPLETED");
});
