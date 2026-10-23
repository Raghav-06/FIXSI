/** Shared setup for backend tests. Tests never depend on a real API key or the machine's .env. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeSettings } from "../src/config.js";
import { build } from "../demo-shop/setup-history.js";

export function tempDir(prefix = "fixsi-test-") {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

let repo = null;

/** The demo-shop target repo with its git history, built once per test file. */
export function demoRepo() {
  if (!repo) {
    repo = path.join(tempDir("fixsi-target-"), "demo-shop");
    build(repo);
  }
  return repo;
}

/** Settings isolated to `dir`, ignoring environment variables and .env files. */
export function settingsFor(dir, overrides = {}) {
  return makeSettings({
    targetRepoPath: demoRepo(),
    workspacesDir: path.join(dir, "ws"),
    databaseUrl: `sqlite:///${path.join(dir, "db.sqlite")}`,
    ...overrides,
  }, { env: {} });
}

export function write(root, rel, content) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
