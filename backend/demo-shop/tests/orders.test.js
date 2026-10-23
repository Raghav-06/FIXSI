import assert from "node:assert/strict";
import { test } from "node:test";

import { CheckoutError } from "../shop/orders.js";
import { Address } from "../shop/users.js";
import { makeShop } from "./helpers.js";

test("checkout places order and reserves stock", () => {
  const { cart, orders, user, inventory } = makeShop();
  cart.add("MUG-01", 2);
  const order = orders.checkout(cart, user);
  assert.equal(order.status, "placed");
  assert.equal(order.quote.total, 3197);
  assert.equal(inventory.reserved("MUG-01"), 2);
  assert.ok(cart.isEmpty());
});

test("checkout with empty cart is rejected", () => {
  const { cart, orders, user } = makeShop();
  assert.throws(() => orders.checkout(cart, user), CheckoutError);
});

test("checkout with explicit address", () => {
  const { cart, orders, user } = makeShop();
  cart.add("TEE-01", 1);
  const order = orders.checkout(cart, user, { shippingAddress: new Address("9 Bay", "Toronto", "M5V", "CA") });
  assert.equal(order.address.country, "CA");
  assert.equal(order.quote.tax, 260);
});

test("checkout with discount code", () => {
  const { cart, orders, user } = makeShop();
  cart.add("TEE-01", 2); // 40.00
  cart.applyCode("WELCOME10");
  const order = orders.checkout(cart, user);
  assert.equal(order.quote.discount, 400);
  assert.equal(order.quote.tax, 297);
});

test("cancel releases stock", () => {
  const { cart, orders, user, inventory } = makeShop();
  cart.add("BAG-01", 3);
  const order = orders.checkout(cart, user);
  orders.cancel(order.id);
  assert.equal(inventory.reserved("BAG-01"), 0);
  assert.equal(orders.get(order.id).status, "cancelled");
});

test("fulfil commits stock", () => {
  const { cart, orders, user, inventory } = makeShop();
  cart.add("BAG-01", 1);
  const order = orders.checkout(cart, user);
  orders.fulfil(order.id);
  assert.equal(inventory.onHand("BAG-01"), 49);
});

test("insufficient stock rolls back", () => {
  const { cart, orders, user, inventory } = makeShop();
  cart.add("MUG-01", 2);
  cart.add("BOOK-01", 50);
  inventory.reserve("BOOK-01", 1); // someone else holds one copy
  assert.throws(() => orders.checkout(cart, user), CheckoutError);
  assert.equal(inventory.reserved("MUG-01"), 0);
});
