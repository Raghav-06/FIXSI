# demo-shop

A tiny storefront domain model — products, inventory, customers, cart,
discount codes, pricing (tax + shipping) and orders. It is the "victim" app
Fixsi debugs in its demo: four realistic bugs are planted in code paths the
test suite does not cover, so all 30 tests pass.

Plain ES modules, no dependencies. Money is integer cents.

## Usage

```js
import { Cart } from "./shop/cart.js";
import { defaultDiscounts } from "./shop/discounts.js";
import { Inventory } from "./shop/inventory.js";
import { formatMoney } from "./shop/money.js";
import { OrderService } from "./shop/orders.js";
import { defaultCatalog } from "./shop/products.js";
import { Address, User } from "./shop/users.js";

const cart = new Cart(defaultCatalog());
cart.add("MUG-01", 2);
const user = new User({ id: "u_1", email: "ada@example.com", name: "Ada" });
user.saveAddress("home", new Address("1 Main St", "Springfield", "62701", "US"));
const order = new OrderService(new Inventory({ "MUG-01": 10 }), defaultDiscounts()).checkout(cart, user);
console.log(formatMoney(order.quote.total)); // USD 31.97
```

## Tests

Uses Node's built-in test runner (`node:test`), Node 20+:

```bash
npm test
```
