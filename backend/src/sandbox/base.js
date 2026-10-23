/** Sandbox interface: run node:test against a workspace and report structured results. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { walkFiles } from "../agent/tools.js";

export const OUTPUT_TAIL_CHARS = 6000;
export const REPORTER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "reporter.mjs");
export const TEST_FILE = /\.test\.[cm]?js$/;

export class SandboxResult {
  constructor({ exitCode, passed = 0, failed = 0, errors = 0, skipped = 0, durationMs = 0, outputTail = "",
    timedOut = false, backend = "local", failures = [], passedIds = [] }) {
    Object.assign(this, { exitCode, passed, failed, errors, skipped, durationMs, outputTail, timedOut, backend, failures,
      passedIds });
  }

  get total() {
    return this.passed + this.failed + this.errors;
  }

  get ok() {
    return this.exitCode === 0 && this.failed === 0 && this.errors === 0 && this.passed > 0;
  }
}

/** Every *.test.js file in the workspace (outside node_modules/.git), as posix paths. */
export function discoverTestFiles(root) {
  return walkFiles(root).filter((rel) => TEST_FILE.test(rel));
}

/** node CLI arguments: JSON report to `reportPath`, human-readable spec output to stdout. */
export function nodeTestArgs(files, reportPath, reporter = pathToFileURL(REPORTER_PATH).href) {
  return [
    "--test",
    "--test-reporter", reporter, "--test-reporter-destination", reportPath,
    "--test-reporter", "spec", "--test-reporter-destination", "stdout",
    ...files,
  ];
}

/** For a file that failed to load, recover the real error (SyntaxError, ERR_MODULE_NOT_FOUND...) from the spec output. */
function loadErrorFromOutput(output, name) {
  const marker = output.indexOf(`✖ ${name} (`);
  if (marker < 0) return null;
  const before = output.slice(Math.max(0, marker - 4000), marker);
  const prev = Math.max(before.lastIndexOf("\n✔ "), before.lastIndexOf("\n✖ "));
  const chunk = (prev >= 0 ? before.slice(prev + 1).split("\n").slice(2).join("\n") : before).trim();
  const message = chunk.match(/^[\w$]*Error\b.*$/m)?.[0] ?? chunk.split("\n").find((l) => l.trim()) ?? "";
  return { message, details: chunk };
}

/** Parse the JSON-lines report written by reporter.mjs into counts + failure details. */
export function parseReport(text, output = "") {
  const out = { passed: 0, failed: 0, errors: 0, skipped: 0, failures: [], passedIds: [] };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const name = String(r.name ?? "");
    const file = r.file ?? "";
    const nodeid = file ? `${file}::${name}` : name;
    if (r.status === "passed") {
      out.passed += 1;
      out.passedIds.push(nodeid);
    } else if (r.status === "skipped") {
      out.skipped += 1;
    } else {
      const fileLevel = r.nesting === 0 && !r.stack && name.replace(/\\/g, "/") === file;
      if (fileLevel || r.failure_type === "hookFailed") {
        const recovered = fileLevel ? loadErrorFromOutput(output, name) : null;
        out.errors += 1;
        out.failures.push({
          nodeid: fileLevel ? file : nodeid,
          kind: "error",
          message: (recovered?.message || r.message || "test file failed to load").slice(0, 2000),
          details: (recovered?.details || r.stack || "").slice(-4000),
        });
      } else {
        out.failed += 1;
        const head = r.error_name && !String(r.message).startsWith(r.error_name) ? `${r.error_name}: ` : "";
        out.failures.push({
          nodeid,
          kind: "failure",
          message: `${head}${r.message ?? ""}`.slice(0, 2000),
          details: String(r.stack ?? "").slice(-4000),
        });
      }
    }
  }
  return out;
}

export function resultFromOutput(exitCode, reportText, output, durationMs, backend, timedOut = false) {
  let counts = {};
  if (reportText) counts = parseReport(reportText, output);
  const total = (counts.passed ?? 0) + (counts.failed ?? 0) + (counts.errors ?? 0) + (counts.skipped ?? 0);
  if (!total && exitCode !== 0) {
    // The runner crashed before any test reported.
    counts = {
      errors: 1,
      failures: [{ nodeid: "<collection>", kind: "error", message: "the test runner did not produce a report",
        details: output.slice(-4000) }],
    };
  }
  return new SandboxResult({ exitCode, durationMs, outputTail: output.slice(-OUTPUT_TAIL_CHARS), timedOut, backend,
    ...counts });
}

export function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
