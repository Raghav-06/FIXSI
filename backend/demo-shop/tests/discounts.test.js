import assert from "node:assert/strict";
import { test } from "node:test";

import { InvalidDiscount, defaultDiscounts } from "../shop/discounts.js";

test("percent code", () => {
  assert.equal(defaultDiscounts().amount("welcome10", 4000), 400);
});

test("fixed code needs minimum", () => {
  const book = defaultDiscounts();
  assert.throws(() => book.amount("FIVEOFF", 2000), InvalidDiscount);
  assert.equal(book.amount("FIVEOFF", 3000), 500);
});

test("expired code", () => {
  assert.throws(() => defaultDiscounts().amount("SPRING24", 5000, "2025-01-01"), InvalidDiscount);
});
