import assert from "node:assert/strict";
import { test } from "node:test";

import { UnknownProduct, defaultCatalog } from "../shop/products.js";

test("get known product", () => {
  assert.equal(defaultCatalog().get("MUG-01").price, 1200);
});

test("unknown product throws", () => {
  assert.throws(() => defaultCatalog().get("NOPE"), UnknownProduct);
});
