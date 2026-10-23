/** Small async/process helpers shared across the backend. */

import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Raised when a run is cancelled (the JS stand-in for asyncio.CancelledError). */
export class CancelledError extends Error {
  name = "CancelledError";

  constructor(message = "cancelled") {
    super(message);
  }
}

export function isCancelled(err, signal) {
  return err instanceof CancelledError || (signal?.aborted ?? false);
}

export function throwIfCancelled(signal) {
  if (signal?.aborted) throw new CancelledError();
}

/** setTimeout as a promise that rejects with CancelledError when `signal` aborts. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export const TIMEOUT = Symbol("timeout");

/** Unbounded FIFO with an awaitable get(timeout). */
export class AsyncQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
  }

  get size() {
    return this.items.length;
  }

  put(item) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  /** Resolves with the next item, or TIMEOUT after `timeoutMs`. */
  get(timeoutMs) {
    if (this.items.length) return Promise.resolve(this.items.shift());
    return new Promise((resolve) => {
      const waiter = (item) => {
        clearTimeout(timer);
        resolve(item);
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        resolve(TIMEOUT);
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
}

/** Run a command; resolves { code, stdout, stderr } and never rejects for a non-zero exit. */
export function run(file, args, { cwd, env, timeoutMs = 30_000, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(file, args, { cwd, env, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === "number" ? err.code : -1) : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") || (err && !stdout ? String(err.message) : "") });
      });
    if (input !== undefined) child.stdin.end(input);
  });
}

/** Kill a process and everything it spawned. */
export function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** Locate an executable on PATH (or check an explicit path). */
export function which(command) {
  if (command.includes("/") || command.includes("\\")) {
    return fs.existsSync(command) ? command : null;
  }
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const ext of ["", ...exts]) {
      const candidate = path.join(dir, command + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

export function toPosix(p) {
  return p.split(path.sep).join("/").replace(/\\/g, "/");
}

export const logger = (scope) => ({
  info: (...a) => console.log(`[${scope}]`, ...a),
  warn: (...a) => console.warn(`[${scope}] warning:`, ...a),
  error: (...a) => console.error(`[${scope}] error:`, ...a),
});
