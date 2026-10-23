/** Apply search/replace edits safely and produce unified diffs. */

import fs from "node:fs";
import path from "node:path";

import { run, toPosix } from "../util.js";

export const FIXSI_TEST_DIR = "tests/fixsi";

export class PatchError extends Error {
  name = "PatchError";
}

/** realpath of the longest existing prefix of `p`, with the missing tail appended. */
function realResolve(p) {
  const rest = [];
  let current = p;
  while (!fs.existsSync(current)) {
    rest.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...rest);
}

/** Resolve `rel` inside `root`; throw PatchError on traversal, absolute paths, symlink escapes or .git. */
export function safePath(root, rel) {
  if (!rel || typeof rel !== "string" || rel.includes("\0")) {
    throw new PatchError("empty or invalid path");
  }
  if (path.isAbsolute(rel) || path.posix.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
    throw new PatchError(`absolute paths are not allowed: ${rel}`);
  }
  const realRoot = fs.realpathSync(root);
  const resolved = realResolve(path.resolve(realRoot, rel));
  const relative = path.relative(realRoot, resolved);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new PatchError(`path escapes the workspace: ${rel}`);
  }
  if (relative.split(path.sep).includes(".git")) {
    throw new PatchError(`refusing to touch git internals: ${rel}`);
  }
  return resolved;
}

export function isTestPath(rel) {
  const parts = toPosix(rel).split("/");
  const name = parts.at(-1);
  return (
    parts.includes("tests") || parts.includes("test") || parts.includes("__tests__")
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(name) || name.startsWith("test_")
  );
}

export function isFixsiTest(rel) {
  return toPosix(rel).startsWith(FIXSI_TEST_DIR + "/");
}

export class AppliedPatch {
  /** `originals` maps rel path -> original content. */
  constructor(originals) {
    this.originals = originals;
  }

  get files() {
    return Object.keys(this.originals).sort();
  }
}

/**
 * Validate every edit first, then write all files (all-or-nothing).
 *
 * - `search` must match exactly once in the current file content.
 * - Edits to pre-existing tests (`protectedTests`) or any test path outside tests/fixsi are rejected.
 */
export function applyEdits(root, edits, protectedTests = new Set()) {
  if (!edits?.length) throw new PatchError("no edits proposed");
  const realRoot = fs.realpathSync(root);
  const staged = {};
  const originals = {};
  for (const edit of edits) {
    const target = safePath(realRoot, edit.path);
    const rel = toPosix(path.relative(realRoot, target));
    if (protectedTests.has(rel) || (isTestPath(rel) && !isFixsiTest(rel))) {
      throw new PatchError(`editing pre-existing tests is not allowed: ${rel}`);
    }
    if (isFixsiTest(rel)) {
      throw new PatchError(`fix edits must target application code, not the reproduction test: ${rel}`);
    }
    if (!(rel in staged)) {
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new PatchError(`file does not exist: ${rel}`);
      }
      staged[rel] = fs.readFileSync(target, "utf8");
      originals[rel] = staged[rel];
    }
    if (!edit.search) throw new PatchError(`empty search block for ${rel}`);
    const count = staged[rel].split(edit.search).length - 1;
    if (count === 0) throw new PatchError(`search block not found in ${rel}`);
    if (count > 1) throw new PatchError(`search block matches ${count} times in ${rel}; make it unique`);
    staged[rel] = staged[rel].replace(edit.search, () => edit.replace);
  }
  for (const [rel, content] of Object.entries(staged)) {
    fs.writeFileSync(path.join(realRoot, rel), content);
  }
  return new AppliedPatch(originals);
}

export function revert(root, patch) {
  for (const [rel, content] of Object.entries(patch.originals)) {
    fs.writeFileSync(path.join(root, rel), content);
  }
}

/** Diff of the workspace against HEAD, including new (untracked) files. */
export async function unifiedDiff(root) {
  const add = await run("git", ["add", "-A"], { cwd: root });
  if (add.code !== 0) return "";
  const out = await run("git", ["diff", "--cached", "--no-color", "HEAD"], { cwd: root });
  await run("git", ["reset", "-q"], { cwd: root });
  return out.code === 0 ? out.stdout : "";
}

/** Diff of tracked `files` against the last commit (the state before a fix attempt). */
export async function diffFiles(root, files) {
  if (!files.length) return "";
  const out = await run("git", ["diff", "--no-color", "HEAD", "--", ...files], { cwd: root });
  return out.code === 0 ? out.stdout : "";
}
