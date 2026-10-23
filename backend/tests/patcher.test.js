import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, test } from "node:test";

import { PatchError, applyEdits, revert, safePath, unifiedDiff } from "../src/agent/patcher.js";
import { demoRepo, tempDir, write } from "./helpers.js";

let root;
beforeEach(() => {
  root = tempDir();
  write(root, "pkg/mod.js", "a = 1\nb = 2\nc = 1\n");
  write(root, "tests/mod.test.js", "test('x', () => {});\n");
});

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("exact match applies and reverts", () => {
  const patch = applyEdits(root, [{ path: "pkg/mod.js", search: "b = 2", replace: "b = 3" }]);
  assert.equal(read("pkg/mod.js"), "a = 1\nb = 3\nc = 1\n");
  revert(root, patch);
  assert.equal(read("pkg/mod.js"), "a = 1\nb = 2\nc = 1\n");
});

test("ambiguous match rejected", () => {
  assert.throws(() => applyEdits(root, [{ path: "pkg/mod.js", search: "= 1", replace: "= 9" }]), /matches 2 times/);
});

test("missing match rejected", () => {
  assert.throws(() => applyEdits(root, [{ path: "pkg/mod.js", search: "zzz", replace: "y" }]), /not found/);
});

test("replacement text is literal ($& is not special)", () => {
  applyEdits(root, [{ path: "pkg/mod.js", search: "b = 2", replace: "b = '$&'" }]);
  assert.match(read("pkg/mod.js"), /b = '\$&'/);
});

test("all or nothing", () => {
  assert.throws(() => applyEdits(root, [
    { path: "pkg/mod.js", search: "b = 2", replace: "b = 3" },
    { path: "pkg/mod.js", search: "nope", replace: "x" },
  ]), PatchError);
  assert.match(read("pkg/mod.js"), /b = 2/);
});

test("protected test rejected", () => {
  assert.throws(() => applyEdits(root, [{ path: "tests/mod.test.js", search: "{}", replace: "{ throw 1 }" }],
    new Set(["tests/mod.test.js"])), /pre-existing tests/);
});

test("any existing test path rejected even if not listed", () => {
  assert.throws(() => applyEdits(root, [{ path: "tests/mod.test.js", search: "{}", replace: "..." }]), /pre-existing tests/);
});

for (const bad of ["../outside.js", "/etc/passwd", "pkg/../../x.js", ".git/config", "C:/Windows/win.ini"]) {
  test(`path traversal rejected: ${bad}`, () => {
    assert.throws(() => safePath(root, bad), PatchError);
    assert.throws(() => applyEdits(root, [{ path: bad, search: "a", replace: "b" }]), PatchError);
  });
}

test("symlink escape rejected", (t) => {
  const outside = tempDir("fixsi-outside-");
  write(outside, "secret.js", "x = 1\n");
  try {
    fs.symlinkSync(outside, path.join(root, "link"), "junction");
  } catch {
    t.skip("symlinks not permitted here");
    return;
  }
  assert.throws(() => safePath(root, "link/secret.js"), /escapes/);
});

test("unified diff includes new files", async () => {
  const ws = path.join(tempDir(), "ws");
  fs.cpSync(demoRepo(), ws, { recursive: true });
  write(ws, "tests/fixsi/new.test.js", "test('new', () => {});\n");
  applyEdits(ws, [{ path: "shop/promotions.js", search: "line.quantity > BULK_THRESHOLD", replace: "line.quantity >= BULK_THRESHOLD" }]);
  const diff = await unifiedDiff(ws);
  assert.match(diff, /\+ {2}if \(line\.quantity >= BULK_THRESHOLD\) \{/);
  assert.match(diff, /b\/tests\/fixsi\/new\.test\.js/);
});
