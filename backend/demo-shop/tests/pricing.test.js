import assert from "node:assert/strict";
import { test } from "node:test";

import { Cart } from "../shop/cart.js";
import { PricingError, quote, shippingCost } from "../shop/pricing.js";
import { defaultCatalog } from "../shop/products.js";

test("simple US quote", () => {
  const cart = new Cart(defaultCatalog());
  cart.add("MUG-01", 2); // 24.00
  const q = quote(cart.items(), "US");
  assert.equal(q.tax, 198);
  assert.equal(q.shipping, 599);
  assert.equal(q.total, 3197);
});

test("free shipping over threshold", () => {
  const cart = new Cart(defaultCatalog());
  cart.add("TEE-01", 4); // 80.00
  const q = quote(cart.items(), "US");
  assert.equal(q.shipping, 0);
  assert.equal(q.total, 8660);
});

test("heavy parcel surcharge", () => {
  assert.equal(shippingCost("US", 4000, 2000), 899);
});

test("bulk discount on large order", () => {
  const cart = new Cart(defaultCatalog());
  cart.add("PEN-01", 12); // 30.00 -> 10% off = 27.00
  const q = quote(cart.items(), "GB");
  assert.equal(q.bulkSavings, 300);
  assert.equal(q.tax, 540);
});

test("no bulk discount on small order", () => {
  const cart = new Cart(defaultCatalog());
  cart.add("PEN-01", 3);
  assert.equal(quote(cart.items(), "US").bulkSavings, 0);
});

test("unsupported country", () => {
  const cart = new Cart(defaultCatalog());
  cart.add("MUG-01");
  assert.throws(() => quote(cart.items(), "ZZ"), PricingError);
});
