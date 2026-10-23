/** Tiny runtime layer for demo-shop: 'Break it' runs a planted bug for real and fires the webhook. */

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { cleanEnv } from "./sandbox/local.js";
import { killTree } from "./util.js";

/** Create the demo-shop git repo (with history) if it doesn't exist yet. */
export function ensureTargetRepo(target, source) {
  if (fs.existsSync(path.join(target, ".git"))) return false;
  const script = path.join(source, "setup-history.js");
  if (!fs.existsSync(script)) throw new Error(`target repo ${target} missing and ${script} not found`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  execFileSync(process.execPath, [script, target], { stdio: "pipe", timeout: 120_000 });
  return true;
}

/** Run an incident's trigger snippet (an ES module) against the target repo; resolves [exitCode, output]. */
export function triggerBug(target, code, timeoutSeconds = 20) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-"], {
      cwd: target, env: cleanEnv(target), stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32",
      windowsHide: true,
    });
    let output = "";
    const collect = (chunk) => {
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      killTree(child);
      resolve([-9, "timed out"]);
    }, timeoutSeconds * 1000);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve([-1, String(err)]);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve([exitCode ?? 0, output]);
    });
    child.stdin.end(code);
  });
}

/** Pull the thrown error line and its stack frames out of Node's uncaught-exception output. */
export function extractError(output) {
  const lines = output.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^[A-Za-z_$][\w$]*(?: \[[\w]+\])?:\s/.test(lines[i]) && /^\s+at /.test(lines[i + 1])) {
      let j = i + 1;
      while (j < lines.length && /^\s+at /.test(lines[j])) j++;
      return { errorLine: lines[i], trace: lines.slice(i, j).join("\n") };
    }
  }
  const last = lines.map((l) => l.trim()).filter(Boolean).at(-1);
  return { errorLine: last || "demo-shop raised an error", trace: "" };
}
