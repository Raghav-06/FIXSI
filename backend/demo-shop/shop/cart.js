/** Shopping cart. */

import { ZERO } from "./money.js";

export class CartError extends Error {
  name = "CartError";
}

export class LineItem {
  constructor({ sku, name, unitPrice, quantity, weightGrams = 0, digital = false }) {
    this.sku = sku;
    this.name = name;
    this.unitPrice = unitPrice;
    this.quantity = quantity;
    this.weightGrams = weightGrams;
    this.digital = digital;
  }

  get lineTotal() {
    return this.unitPrice * this.quantity;
  }

  copy() {
    return new LineItem(this);
  }
}

export class Cart {
  static MAX_QUANTITY = 99;

  constructor(catalog) {
    this._catalog = catalog;
    this._lines = new Map();
    this.discountCode = null;
  }

  add(sku, quantity = 1) {
    if (quantity <= 0) {
      throw new CartError("quantity must be positive");
    }
    let line = this._lines.get(sku);
    if (line === undefined) {
      const product = this._catalog.get(sku);
      line = new LineItem({
        sku: product.sku,
        name: product.name,
        unitPrice: product.price,
        quantity: 0,
        weightGrams: product.weightGrams,
        digital: product.digital,
      });
      this._lines.set(sku, line);
    }
    if (line.quantity + quantity > Cart.MAX_QUANTITY) {
      throw new CartError(`at most ${Cart.MAX_QUANTITY} of ${sku} per order`);
    }
    line.quantity += quantity;
    return line;
  }

  setQuantity(sku, quantity) {
    if (!this._lines.has(sku)) {
      throw new CartError(`${sku} is not in the cart`);
    }
    if (quantity < 0 || quantity > Cart.MAX_QUANTITY) {
      throw new CartError("invalid quantity");
    }
    if (quantity === 0) {
      this._lines.delete(sku);
    } else {
      this._lines.get(sku).quantity = quantity;
    }
  }

  remove(sku) {
    this._lines.delete(sku);
  }

  /**
   * Rebuild the cart from saved line items (e.g. "Buy again" on a past order).
   *
   * The cart keeps its own copies: later changes to the cart never modify
   * the saved items.
   */
  restore(items) {
    this._lines = new Map();
    for (const item of items) {
      this._lines.set(item.sku, item);
    }
  }

  /** Return a snapshot of the cart's line items. */
  items() {
    return [...this._lines.values()].map((line) => line.copy());
  }

  isEmpty() {
    return this._lines.size === 0;
  }

  itemCount() {
    let count = 0;
    for (const line of this._lines.values()) {
      count += line.quantity;
    }
    return count;
  }

  subtotal() {
    let total = ZERO;
    for (const line of this._lines.values()) {
      total += line.lineTotal;
    }
    return total;
  }

  applyCode(code) {
    this.discountCode = code ? code.trim().toUpperCase() : null;
  }

  clear() {
    this._lines = new Map();
    this.discountCode = null;
  }
}
