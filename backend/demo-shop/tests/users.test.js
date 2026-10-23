import assert from "node:assert/strict";
import { test } from "node:test";

import { Address, UserDirectory } from "../shop/users.js";

test("register and find", () => {
  const users = new UserDirectory();
  const u = users.register("Grace@Example.com", "Grace");
  assert.equal(users.findByEmail("grace@example.com"), u);
});

test("duplicate email rejected", () => {
  const users = new UserDirectory();
  users.register("a@example.com", "A");
  assert.throws(() => users.register("A@example.com", "A again"), RangeError);
});

test("first saved address becomes default", () => {
  const u = new UserDirectory().register("b@example.com", "B");
  u.saveAddress("work", new Address("2 Elm", "Austin", "73301", "US"));
  assert.equal(u.defaultLabel, "work");
});
