/** Repo tools for the agent. Everything is scoped to one run's workspace copy. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { run, toPosix } from "../util.js";
import { FIXSI_TEST_DIR, PatchError, applyEdits, diffFiles, isTestPath, safePath } from "./patcher.js";

const MAX_READ_CHARS = 20_000;
export const SKIP_DIRS = new Set([".git", "node_modules", ".fixsi-cache", "coverage"]);
const NOT_COPIED = new Set(["node_modules", ".fixsi-cache", "coverage"]);
const CODE_FILE = /\.[cm]?js$/;

export class EditsLockedError extends PatchError {
  name = "EditsLockedError";
}

/** Glob -> RegExp supporting `**`, `*` and `?` (paths are posix, relative to the workspace). */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function walkFiles(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(toPosix(path.relative(root, full)));
    }
  };
  visit(root);
  return out.sort();
}

export class Workspace {
  constructor(root, sandbox, logs = "") {
    this.root = fs.realpathSync(root);
    this.sandbox = sandbox;
    this.logs = logs;
    this._editsUnlocked = false;
    this.protectedTests = {};
  }

  // -- setup ------------------------------------------------------------------
  static create(source, dest, sandbox, logs = "") {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(source, dest, { recursive: true, dereference: true, filter: (src) => !NOT_COPIED.has(path.basename(src)) });
    const ws = new Workspace(dest, sandbox, logs);
    ws.protectedTests = ws.snapshotTests();
    return ws;
  }

  snapshotTests() {
    const out = {};
    for (const rel of this.listFiles()) {
      if (CODE_FILE.test(rel) && isTestPath(rel) && !rel.startsWith(FIXSI_TEST_DIR + "/")) {
        out[rel] = crypto.createHash("sha256").update(fs.readFileSync(path.join(this.root, rel))).digest("hex");
      }
    }
    return out;
  }

  modifiedProtectedTests() {
    const current = this.snapshotTests();
    const changed = Object.keys(this.protectedTests).filter((p) => current[p] !== this.protectedTests[p]);
    const added = Object.keys(current).filter((p) => !(p in this.protectedTests));
    return [...changed, ...added].sort();
  }

  // -- reading ----------------------------------------------------------------
  listFiles(glob = "**/*") {
    const re = globToRegExp(glob);
    return walkFiles(this.root).filter((rel) => re.test(rel));
  }

  readFile(rel, startLine = null, endLine = null) {
    const target = safePath(this.root, rel);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new PatchError(`no such file: ${rel}`);
    const lines = fs.readFileSync(target, "utf8").split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    const start = Math.max(1, startLine ?? 1);
    const end = Math.min(lines.length, endLine ?? lines.length);
    const numbered = [];
    for (let i = start; i <= end; i++) numbered.push(`${String(i).padStart(4)}| ${lines[i - 1]}`);
    return numbered.join("\n").slice(0, MAX_READ_CHARS);
  }

  raw(rel) {
    return fs.readFileSync(safePath(this.root, rel), "utf8");
  }

  exists(rel) {
    try {
      const target = safePath(this.root, rel);
      return fs.existsSync(target) && fs.statSync(target).isFile();
    } catch {
      return false;
    }
  }

  searchCode(regex, maxHits = 50) {
    let pattern;
    try {
      pattern = new RegExp(regex);
    } catch (err) {
      throw new PatchError(`bad regex: ${err.message}`);
    }
    const hits = [];
    for (const rel of this.listFiles("**/*.js")) {
      const lines = fs.readFileSync(path.join(this.root, rel), "utf8").split(/\r?\n/);
      for (let n = 0; n < lines.length; n++) {
        if (pattern.test(lines[n])) {
          hits.push(`${rel}:${n + 1}: ${lines[n].trim()}`);
          if (hits.length >= maxHits) return hits;
        }
      }
    }
    return hits;
  }

  async git(...args) {
    const out = await run("git", args, { cwd: this.root, timeoutMs: 30_000 });
    return out.code === 0 ? out.stdout : "";
  }

  gitLog(n = 10) {
    return this.git("log", `-n${Math.max(1, Math.min(n, 50))}`, "--date=short", "--pretty=format:%h %ad %an  %s", "--stat");
  }

  async gitShow(commit) {
    if (!/^(?:[0-9a-fA-F]{4,40}|HEAD(?:~\d+)?)$/.test(commit)) {
      throw new PatchError(`invalid commit ref: ${commit}`);
    }
    return (await this.git("show", "--no-color", "--stat", "--patch", commit)).slice(0, MAX_READ_CHARS);
  }

  readLogs() {
    return this.logs;
  }

  // -- writing ----------------------------------------------------------------
  writeTest(p, content) {
    let rel = toPosix(p).replace(/^[./]+/, "");
    if (!rel.startsWith(FIXSI_TEST_DIR + "/")) rel = `${FIXSI_TEST_DIR}/${path.posix.basename(rel)}`;
    const name = path.posix.basename(rel);
    if (!/\.test\.js$/.test(name)) {
      const stem = name.replace(/\.[^.]+$/, "").replace(/\.(test|spec)$/, "").replace(/^test_/, "");
      rel = `${path.posix.dirname(rel)}/${stem || "repro"}.test.js`;
    }
    const target = safePath(this.root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return rel;
  }

  removeTest(rel) {
    const target = safePath(this.root, rel);
    if (rel.startsWith(FIXSI_TEST_DIR + "/") && fs.existsSync(target)) fs.unlinkSync(target);
  }

  /** Called by the orchestrator only once a reproduction test has failed as predicted. */
  unlockEdits() {
    this._editsUnlocked = true;
  }

  get editsUnlocked() {
    return this._editsUnlocked;
  }

  applyEdits(edits) {
    if (!this._editsUnlocked) {
      throw new EditsLockedError("application code is locked until a reproduction test fails");
    }
    return applyEdits(this.root, edits, new Set(Object.keys(this.protectedTests)));
  }

  diffFiles(files) {
    return diffFiles(this.root, files);
  }

  runTests(selector = null, { signal } = {}) {
    if (selector) safePath(this.root, selector.split("::")[0]);
    return this.sandbox.runTests(this.root, selector, { signal });
  }
}
