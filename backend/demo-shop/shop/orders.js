/** Checkout and order lifecycle. */

import { InventoryError } from "./inventory.js";
import { ZERO, formatMoney } from "./money.js";
import { quote } from "./pricing.js";

export class CheckoutError extends Error {
  name = "CheckoutError";
}

function logInfo(message) {
  if (process.env.SHOP_LOG === "1") {
    console.info(`INFO  shop.orders ${message}`);
  }
}

export class Order {
  constructor({ id, userId, lines, address, quote, status = "placed", notes = [] }) {
    this.id = id;
    this.userId = userId;
    this.lines = lines;
    this.address = address;
    this.quote = quote;
    this.status = status;
    this.notes = notes;
  }
}

export class OrderService {
  constructor(inventory, discounts) {
    this._inventory = inventory;
    this._discounts = discounts;
    this._orders = new Map();
    this._nextId = 1000;
  }

  /**
   * Place an order for everything in `cart`.
   *
   * Ships to `shippingAddress` if given, otherwise to the user's default
   * saved address. Throws CheckoutError if the cart is empty or if no
   * shipping address is available.
   */
  checkout(cart, user, { shippingAddress = null, today } = {}) {
    if (cart.isEmpty()) {
      throw new CheckoutError("cart is empty");
    }
    const lines = cart.items();
    const address = shippingAddress ?? user.addresses[user.defaultLabel];
    let discount = ZERO;
    if (cart.discountCode) {
      discount = this._discounts.amount(cart.discountCode, cart.subtotal(), today);
    }
    const orderQuote = quote(lines, address.country, discount);

    const reserved = [];
    try {
      for (const line of lines) {
        this._inventory.reserve(line.sku, line.quantity);
        reserved.push(line);
      }
    } catch (err) {
      if (!(err instanceof InventoryError)) {
        throw err;
      }
      for (const line of reserved) {
        this._inventory.release(line.sku, line.quantity);
      }
      throw new CheckoutError(err.message, { cause: err });
    }

    const order = new Order({
      id: `ord_${this._nextId}`,
      userId: user.id,
      lines,
      address,
      quote: orderQuote,
    });
    this._nextId += 1;
    this._orders.set(order.id, order);
    cart.clear();
    const items = lines.reduce((sum, line) => sum + line.quantity, 0);
    logInfo(`order placed id=${order.id} user=${user.id} items=${items} total=${formatMoney(orderQuote.total)}`);
    return order;
  }

  get(orderId) {
    const order = this._orders.get(orderId);
    if (order === undefined) {
      throw new CheckoutError(`unknown order ${orderId}`);
    }
    return order;
  }

  cancel(orderId) {
    const order = this.get(orderId);
    if (order.status !== "placed") {
      throw new CheckoutError(`order ${orderId} is ${order.status}; cannot cancel`);
    }
    for (const line of order.lines) {
      this._inventory.release(line.sku, line.quantity);
    }
    order.status = "cancelled";
    logInfo(`order cancelled id=${order.id}`);
    return order;
  }

  fulfil(orderId) {
    const order = this.get(orderId);
    if (order.status !== "placed") {
      throw new CheckoutError(`order ${orderId} is ${order.status}; cannot fulfil`);
    }
    for (const line of order.lines) {
      this._inventory.commit(line.sku, line.quantity);
    }
    order.status = "fulfilled";
    return order;
  }

  /** Load a past order's items into `cart` so the customer can reorder. */
  buyAgain(orderId, cart) {
    cart.restore(this.get(orderId).lines);
    return cart;
  }
}
