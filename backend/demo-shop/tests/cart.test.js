import assert from "node:assert/strict";
import { test } from "node:test";

import { Cart, CartError } from "../shop/cart.js";
import { defaultCatalog } from "../shop/products.js";

test("add merges same sku", () => {
  const cart = new Cart(defaultCatalog());
  cart.add("MUG-01");
  cart.add("MUG-01", 2);
  assert.equal(cart.itemCount(), 3);
  assert.equal(cart.subtotal(), 3600);
});

test("add rejects non-positive quantity", () => {
  const cart = new Cart(defaultCatalog());
  assert.throws(() => cart.add("MUG-01", 0), CartError);
});

test("set quantity zero removes line", () => {
  const cart = new Cart(defaultCatalog());
  cart.add("TEE-01", 2);
  cart.setQuantity("TEE-01", 0);
  assert.ok(cart.isEmpty());
});

test("quantity cap", () => {
  const cart = new Cart(defaultCatalog());
  assert.throws(() => cart.add("PEN-01", 100), CartError);
});

test("items() is a snapshot", () => {
  const cart = new Cart(defaultCatalog());
  cart.add("MUG-01", 2);
  const snapshot = cart.items();
  cart.setQuantity("MUG-01", 4);
  assert.equal(snapshot[0].quantity, 2);
});
