/** Shared test setup (the equivalent of fixtures): call makeShop() at the start of a test. */

import { Cart } from "../shop/cart.js";
import { defaultDiscounts } from "../shop/discounts.js";
import { Inventory } from "../shop/inventory.js";
import { OrderService } from "../shop/orders.js";
import { defaultCatalog } from "../shop/products.js";
import { Address, User } from "../shop/users.js";

export const STOCK = { "MUG-01": 50, "TEE-01": 50, "BAG-01": 50, "PEN-01": 500, "BOOK-01": 50, "EBOOK-01": 10000 };

/** Fresh catalog, empty cart, stocked inventory, order service, a home address and a user who saved it. */
export function makeShop() {
  const catalog = defaultCatalog();
  const inventory = new Inventory(STOCK);
  const orders = new OrderService(inventory, defaultDiscounts());
  const home = new Address("1 Main St", "Springfield", "62701", "US");
  const user = new User({ id: "u_1", email: "ada@example.com", name: "Ada" });
  user.saveAddress("home", home);
  return { catalog, cart: new Cart(catalog), inventory, orders, home, user };
}
