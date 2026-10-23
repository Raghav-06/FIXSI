/**
 * Nebius AI Cloud Serverless Jobs sandbox.
 *
 * Each test run is submitted as a job via the `nebius` CLI:
 *   - the workspace (minus .git and node_modules) is packed into a tar.gz and attached with --inject-file
 *     (Serverless Jobs caps injected files at 64 KiB, which comfortably fits demo-shop),
 *   - a container (NEBIUS_JOBS_IMAGE, default node:22-slim) unpacks it, runs node --test with Fixsi's
 *     reporter, and prints the JSON report base64-encoded between markers,
 *   - Fixsi polls `nebius ai job get` until the job finishes, then reads `nebius ai job logs`.
 *
 * Anything missing or failing (CLI not installed, no project, quota, timeout) falls back to the
 * local sandbox with a warning, so a run never breaks because Jobs isn't set up.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { walkFiles } from "../agent/tools.js";
import { CancelledError, logger, run, sleep, which } from "../util.js";
import { REPORTER_PATH, discoverTestFiles, nodeTestArgs, resultFromOutput } from "./base.js";
import { LocalSandbox } from "./local.js";

const log = logger("fixsi.sandbox.jobs");

export const INJECT_LIMIT = 64 * 1024;
const TERMINAL_STATES = new Set(["COMPLETED", "SUCCEEDED", "FAILED", "ERROR", "CANCELLED", "CANCELED", "DELETED", "STOPPED"]);

export function runScript(files) {
  const args = nodeTestArgs(files, "/tmp/report.jsonl", "/fixsi/reporter.mjs").join(" ");
  return `#!/bin/sh
mkdir -p /w && tar xzf /fixsi/ws.tgz -C /w && cd /w || exit 97
NO_COLOR=1 node ${args}
code=$?
echo "<<<FIXSI_REPORT"
base64 /tmp/report.jsonl | tr -d '\\n'
echo
echo "FIXSI_REPORT>>>"
echo "FIXSI_EXIT=$code"
`;
}

export class JobsUnavailable extends Error {
  name = "JobsUnavailable";
}

function tarHeader(name, size, mtime) {
  const header = Buffer.alloc(512);
  let prefix = "";
  if (Buffer.byteLength(name) > 100) { // ustar splits long paths into prefix/name at a slash
    const cut = [...name.matchAll(/\//g)].map((m) => m.index)
      .find((i) => Buffer.byteLength(name.slice(i + 1)) <= 100 && Buffer.byteLength(name.slice(0, i)) <= 155);
    if (cut === undefined) throw new JobsUnavailable(`path too long for tar: ${name}`);
    [prefix, name] = [name.slice(0, cut), name.slice(cut + 1)];
  }
  const put = (value, offset, length) => header.write(value, offset, length, "utf8");
  const octal = (n, length) => n.toString(8).padStart(length - 1, "0") + "\0";
  put(name, 0, 100);
  put(octal(0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(Math.floor(mtime / 1000), 12), 136, 12);
  put("        ", 148, 8); // checksum placeholder
  put("0", 156, 1);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const byte of header) sum += byte;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return header;
}

/** tar.gz (ustar) of the workspace without .git / node_modules, built in-process so no system `tar` is needed. */
export function packWorkspace(root) {
  const chunks = [];
  for (const rel of walkFiles(root)) {
    const full = path.join(root, rel);
    const data = fs.readFileSync(full);
    chunks.push(tarHeader(rel, data.length, fs.statSync(full).mtimeMs), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

export function parseJobLogs(logs) {
  const m = /<<<FIXSI_REPORT\s*([\s\S]*?)\s*FIXSI_REPORT>>>/.exec(logs);
  let report = null;
  if (m) {
    try {
      report = Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8") || null;
    } catch {
      report = null;
    }
  }
  const code = /FIXSI_EXIT=(\d+)/.exec(logs);
  return [code ? Number(code[1]) : 1, report, m ? logs.slice(0, m.index) : logs];
}

export function findState(obj) {
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const s = findState(v);
      if (s) return s;
    }
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if ((k === "state" || k === "phase") && typeof v === "string") return v.toUpperCase();
    }
    for (const v of Object.values(obj)) {
      const s = findState(v);
      if (s) return s;
    }
  }
  return null;
}

export class NebiusJobsSandbox {
  name = "nebius_jobs";

  constructor(settings, fallback, pollSeconds = 5) {
    this.s = settings;
    this.fallback = fallback;
    this.pollSeconds = pollSeconds;
    this.warned = false;
  }

  unavailableReason() {
    if (!this.s.nebiusJobsProjectId) return "NEBIUS_JOBS_PROJECT_ID is not set";
    if (!which(this.s.nebiusCliPath)) return `nebius CLI not found (${this.s.nebiusCliPath})`;
    return null;
  }

  async runTests(workspacePath, selector = null, { signal } = {}) {
    const reason = this.unavailableReason();
    if (reason) {
      if (!this.warned) {
        log.warn(`Serverless Jobs sandbox unavailable (${reason}); using local sandbox`);
        this.warned = true;
      }
      return this._fallback(workspacePath, selector, reason, signal);
    }
    try {
      return await this._runJob(workspacePath, selector, signal);
    } catch (err) {
      if (err instanceof CancelledError) throw err;
      log.warn(`Serverless Jobs run failed (${err.name}); falling back to local sandbox`);
      return this._fallback(workspacePath, selector, `job failed: ${err.name}`, signal);
    }
  }

  async _fallback(workspacePath, selector, reason, signal) {
    const res = await this.fallback.runTests(workspacePath, selector, { signal });
    res.backend = "local (jobs fallback)";
    res.outputTail = `[fixsi] Serverless Jobs unavailable: ${reason}\n${res.outputTail}`;
    return res;
  }

  async _cli(args, timeoutSeconds = 120) {
    // A .js path runs with node (handy for local shims); anything else is executed directly.
    const cli = this.s.nebiusCliPath;
    const [file, argv] = /\.[cm]?js$/.test(cli) ? [process.execPath, [cli, ...args]] : [cli, args];
    const out = await run(file, argv, { timeoutMs: timeoutSeconds * 1000 });
    if (out.code !== 0) {
      throw new JobsUnavailable(`nebius ${args.slice(0, 3).join(" ")} exited ${out.code}: ${out.stderr.slice(0, 300)}`);
    }
    return out.stdout;
  }

  async _runJob(workspacePath, selector, signal) {
    const files = selector ? [selector.split("::")[0]] : discoverTestFiles(workspacePath);
    if (files.some((f) => !/^[\w./-]+$/.test(f))) throw new JobsUnavailable("unsafe test path");
    const started = performance.now();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fixsi-job-"));
    let jobId;
    try {
      const archive = packWorkspace(workspacePath);
      if (archive.length > INJECT_LIMIT) {
        throw new JobsUnavailable(`workspace archive is ${archive.length} bytes (> 64 KiB inject limit)`);
      }
      const tgz = path.join(tmp, "ws.tgz");
      fs.writeFileSync(tgz, archive);
      const script = path.join(tmp, "run.sh");
      fs.writeFileSync(script, runScript(files));
      const args = [
        "ai", "job", "create", "--async", "--format", "jsonpath={.resource_id}",
        "--name", `fixsi-${crypto.randomBytes(5).toString("hex")}`, "--parent-id", this.s.nebiusJobsProjectId,
        "--image", this.s.nebiusJobsImage, "--container-command", "sh", "--args", "/fixsi/run.sh",
        "--inject-file", `${tgz}:/fixsi/ws.tgz`, "--inject-file", `${script}:/fixsi/run.sh`,
        "--inject-file", `${REPORTER_PATH}:/fixsi/reporter.mjs`,
        "--platform", this.s.nebiusJobsPlatform, "--preset", this.s.nebiusJobsPreset,
        "--disk-size", "32Gi", "--timeout", "1h", "--restart-policy", "never",
      ];
      if (this.s.nebiusJobsSubnetId) args.push("--subnet-id", this.s.nebiusJobsSubnetId);
      jobId = (await this._cli(args)).trim().replace(/^"|"$/g, "");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    if (!jobId) throw new JobsUnavailable("job create returned no id");

    const deadline = performance.now() + this.s.nebiusJobsTimeoutSeconds * 1000;
    let state = null;
    let logs;
    try {
      for (;;) {
        state = findState(JSON.parse(await this._cli(["ai", "job", "get", jobId, "--format", "json"])));
        if (TERMINAL_STATES.has(state)) break;
        if (performance.now() > deadline) throw new JobsUnavailable(`job ${jobId} did not finish in time (state ${state})`);
        await sleep(this.pollSeconds * 1000, signal);
      }
      logs = await this._cli(["ai", "job", "logs", jobId]);
    } catch (err) {
      await this._cli(["ai", "job", "cancel", jobId], 30).catch(() => {});
      throw err;
    }
    const [exitCode, report, output] = parseJobLogs(logs);
    if (report === null) throw new JobsUnavailable(`job ${jobId} finished (${state}) without a test report`);
    const res = resultFromOutput(exitCode, report, output, Math.round(performance.now() - started), this.name);
    res.outputTail = `[fixsi] ran as Nebius Serverless Job ${jobId}\n${res.outputTail}`;
    return res;
  }
}

export function makeSandbox(settings) {
  const local = new LocalSandbox(settings.sandboxTimeoutSeconds);
  if (settings.sandboxMode === "nebius_jobs") return new NebiusJobsSandbox(settings, local);
  return local;
}
