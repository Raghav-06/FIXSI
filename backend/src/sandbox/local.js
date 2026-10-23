/** Local subprocess sandbox: clean env, cwd locked to the workspace, memory cap, hard timeout. */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CancelledError, killTree } from "../util.js";
import { SandboxResult, discoverTestFiles, nodeTestArgs, readIfExists, resultFromOutput } from "./base.js";

const MEMORY_LIMIT_MB = 1024;
const MAX_OUTPUT_CHARS = 2_000_000;
const ALLOWED_ENV = ["PATH", "LANG"];
// Windows needs these for node itself to start; none of them carry secrets.
const WINDOWS_ENV = ["SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"];

/** Only PATH, LANG and a fake HOME (plus Windows system vars). Never secrets. */
export function cleanEnv(workspace) {
  const pick = (k) => Object.keys(process.env).find((name) => name.toUpperCase() === k);
  const env = {};
  for (const key of [...ALLOWED_ENV, ...(process.platform === "win32" ? WINDOWS_ENV : [])]) {
    const name = pick(key);
    if (name) env[key] = process.env[name];
  }
  env.PATH ??= "/usr/local/bin:/usr/bin:/bin";
  env.LANG ??= "C.UTF-8";
  env.HOME = workspace;
  if (process.platform === "win32") env.USERPROFILE = workspace;
  env.NODE_ENV = "test";
  env.NO_COLOR = "1";
  env.NODE_OPTIONS = `--max-old-space-size=${MEMORY_LIMIT_MB}`;
  return env;
}

export class LocalSandbox {
  name = "local";

  constructor(timeoutSeconds = 120, nodePath = process.execPath) {
    this.timeoutSeconds = timeoutSeconds;
    this.nodePath = nodePath;
  }

  async runTests(workspacePath, selector = null, { signal } = {}) {
    const root = fs.realpathSync(workspacePath);
    const files = selector ? [selector.split("::")[0]] : discoverTestFiles(root);
    if (!files.length) {
      return new SandboxResult({ exitCode: 5, outputTail: "[fixsi] no *.test.js files found", backend: this.name });
    }
    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "fixsi-report-"));
    const report = path.join(reportDir, "report.jsonl");
    const started = performance.now();
    try {
      const { code, output, timedOut } = await this._spawn(root, nodeTestArgs(files, report), signal);
      const durationMs = Math.round(performance.now() - started);
      if (timedOut) {
        return resultFromOutput(-9, null, `${output}\n[fixsi] test run killed after ${this.timeoutSeconds}s timeout`,
          durationMs, this.name, true);
      }
      return resultFromOutput(code ?? -1, readIfExists(report), output, durationMs, this.name);
    } finally {
      fs.rmSync(reportDir, { recursive: true, force: true });
    }
  }

  _spawn(cwd, args, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new CancelledError());
      const child = spawn(this.nodePath, args, {
        cwd, env: cleanEnv(cwd), stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
        windowsHide: true,
      });
      let output = "";
      let timedOut = false;
      let cancelled = false;
      const collect = (chunk) => {
        output += chunk.toString("utf8");
        if (output.length > MAX_OUTPUT_CHARS) output = output.slice(-MAX_OUTPUT_CHARS / 2);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, this.timeoutSeconds * 1000);
      const onAbort = () => {
        cancelled = true;
        killTree(child);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      child.on("error", (err) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (cancelled) reject(new CancelledError());
        else resolve({ code, output, timedOut });
      });
    });
  }
}
