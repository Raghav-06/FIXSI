/**
 * Stock tracking with reservations.
 *
 * Checkout reserves stock, fulfilment commits it, cancellation releases it.
 */

export class InventoryError extends Error {
  name = "InventoryError";
}

export class InsufficientStock extends InventoryError {
  name = "InsufficientStock";
}

export class Inventory {
  constructor(stock = {}) {
    this._onHand = new Map(Object.entries(stock));
    this._reserved = new Map();
  }

  restock(sku, quantity) {
    if (quantity <= 0) {
      throw new RangeError("restock quantity must be positive");
    }
    this._onHand.set(sku, this.onHand(sku) + quantity);
  }

  onHand(sku) {
    return this._onHand.get(sku) ?? 0;
  }

  reserved(sku) {
    return this._reserved.get(sku) ?? 0;
  }

  available(sku) {
    return this.onHand(sku) - this.reserved(sku);
  }

  reserve(sku, quantity) {
    if (quantity <= 0) {
      throw new RangeError("reserve quantity must be positive");
    }
    if (this.available(sku) < quantity) {
      throw new InsufficientStock(
        `cannot reserve ${quantity} units of ${sku}: only ${this.available(sku)} available`,
      );
    }
    this._reserved.set(sku, this.reserved(sku) + quantity);
  }

  release(sku, quantity) {
    const held = this.reserved(sku);
    if (quantity > held) {
      throw new InventoryError(
        `cannot release ${quantity} units of ${sku}: only ${held} reserved`,
      );
    }
    this._reserved.set(sku, held - quantity);
  }

  commit(sku, quantity) {
    const held = this.reserved(sku);
    if (quantity > held) {
      throw new InventoryError(
        `cannot commit ${quantity} units of ${sku}: only ${held} reserved`,
      );
    }
    this._reserved.set(sku, held - quantity);
    this._onHand.set(sku, this.onHand(sku) - quantity);
  }
}
