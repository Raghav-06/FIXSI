import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, test } from "node:test";

import { PatchError } from "../src/agent/patcher.js";
import { EditsLockedError, Workspace } from "../src/agent/tools.js";
import { LocalSandbox } from "../src/sandbox/local.js";
import { demoRepo, tempDir } from "./helpers.js";

let ws;
beforeEach(() => {
  ws = Workspace.create(demoRepo(), path.join(tempDir(), "run1"), new LocalSandbox(60), "TypeError: boom");
});

test("list and read", () => {
  const files = ws.listFiles("shop/*.js");
  assert.ok(files.includes("shop/cart.js"));
  assert.ok(!files.includes("tests/cart.test.js"));
  assert.ok(ws.listFiles("**/*.js").includes("tests/cart.test.js"));
  assert.match(ws.readFile("shop/cart.js", 1, 3), / {3}1\| /);
  assert.throws(() => ws.readFile("../../etc/passwd"), PatchError);
});

test("search and git", async () => {
  assert.ok(ws.searchCode("toFixed\\(2\\)").some((h) => h.startsWith("shop/money.js:")));
  assert.match(await ws.gitLog(5), /refactor: round prices consistently/);
  assert.match(await ws.gitShow("HEAD~1"), /toFixed\(2\)/);
  await assert.rejects(ws.gitShow("HEAD; rm -rf /"), PatchError);
  assert.equal(ws.readLogs(), "TypeError: boom");
});

test("writeTest is confined to tests/fixsi", () => {
  assert.equal(ws.writeTest("tests/fixsi/a.test.js", "x"), "tests/fixsi/a.test.js");
  assert.equal(ws.writeTest("../../evil.js", "x"), "tests/fixsi/evil.test.js");
  assert.equal(ws.writeTest("tests/cart.test.js", "x"), "tests/fixsi/cart.test.js");
  assert.equal(ws.writeTest("test_thing.py", "x"), "tests/fixsi/thing.test.js");
  assert.match(ws.raw("tests/cart.test.js"), /add merges same sku/);
});

test("edits are locked until unlocked", () => {
  const edit = { path: "shop/promotions.js", search: "> BULK_THRESHOLD", replace: ">= BULK_THRESHOLD" };
  assert.throws(() => ws.applyEdits([edit]), EditsLockedError);
  ws.unlockEdits();
  assert.deepEqual(ws.applyEdits([edit]).files, ["shop/promotions.js"]);
});

test("protected tests are snapshotted", () => {
  assert.ok("tests/orders.test.js" in ws.protectedTests);
  assert.ok("tests/helpers.js" in ws.protectedTests);
  assert.deepEqual(ws.modifiedProtectedTests(), []);
  fs.writeFileSync(path.join(ws.root, "tests/orders.test.js"), "// tampered\n");
  assert.deepEqual(ws.modifiedProtectedTests(), ["tests/orders.test.js"]);
});

test("runTests with a selector", async () => {
  const res = await ws.runTests("tests/cart.test.js");
  assert.ok(res.ok, res.outputTail);
  assert.equal(res.passed, 5);
});
