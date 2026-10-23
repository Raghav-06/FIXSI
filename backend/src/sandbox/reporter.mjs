/**
 * node:test reporter used by the Fixsi sandbox: one JSON object per finished test.
 *
 * The built-in junit reporter drops the file a test belongs to, so Fixsi ships this one
 * and passes it with --test-reporter. It must stay dependency-free: it runs inside
 * the workspace's test process (and inside Nebius Serverless Jobs containers).
 */

import path from "node:path";

function rel(file) {
  if (!file) return null;
  const p = file.startsWith("file:") ? new URL(file).pathname.replace(/^\/([A-Za-z]:)/, "$1") : file;
  return path.relative(process.cwd(), p).split(path.sep).join("/");
}

function describe(err) {
  const cause = err && typeof err === "object" && "cause" in err && err.cause != null ? err.cause : err;
  if (cause && typeof cause === "object") {
    return {
      error_name: String(cause.name ?? cause.constructor?.name ?? "Error"),
      error_code: cause.code != null ? String(cause.code) : null,
      message: String(cause.message ?? cause),
      stack: String(cause.stack ?? ""),
    };
  }
  return { error_name: "Error", error_code: null, message: String(cause), stack: "" };
}

export default async function* fixsiReporter(source) {
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const d = event.data;
    if (d.details?.type === "suite") continue;
    const out = {
      status: event.type === "test:pass" ? (d.skip !== undefined || d.todo !== undefined ? "skipped" : "passed") : "failed",
      file: rel(d.file),
      name: d.name,
      nesting: d.nesting,
      duration_ms: d.details?.duration_ms ?? 0,
    };
    if (event.type === "test:fail") {
      const err = d.details?.error;
      out.failure_type = err?.failureType ?? null;
      Object.assign(out, describe(err));
    }
    yield JSON.stringify(out) + "\n";
  }
}
