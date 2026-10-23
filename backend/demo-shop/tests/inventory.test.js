import assert from "node:assert/strict";
import { test } from "node:test";

import { InsufficientStock, Inventory, InventoryError } from "../shop/inventory.js";

test("reserve reduces available", () => {
  const inv = new Inventory({ "MUG-01": 5 });
  inv.reserve("MUG-01", 2);
  assert.equal(inv.available("MUG-01"), 3);
  assert.equal(inv.onHand("MUG-01"), 5);
});

test("cannot reserve more than available", () => {
  const inv = new Inventory({ "MUG-01": 1 });
  assert.throws(() => inv.reserve("MUG-01", 2), InsufficientStock);
});

test("commit removes stock", () => {
  const inv = new Inventory({ "MUG-01": 5 });
  inv.reserve("MUG-01", 2);
  inv.commit("MUG-01", 2);
  assert.equal(inv.onHand("MUG-01"), 3);
  assert.equal(inv.reserved("MUG-01"), 0);
});

test("release more than reserved is an error", () => {
  const inv = new Inventory({ "MUG-01": 5 });
  assert.throws(() => inv.release("MUG-01", 1), InventoryError);
});
