/** Discount codes entered by the customer. */

import { formatMoney, toCents } from "./money.js";

export class InvalidDiscount extends Error {
  name = "InvalidDiscount";
}

export class DiscountCode {
  /**
   * `kind` is "percent" (value = percent off) or "fixed" (value = cents off).
   * `expires` is an ISO date ("2024-05-31") or null.
   */
  constructor({ code, kind, value, minSubtotal = 0, expires = null }) {
    this.code = code;
    this.kind = kind;
    this.value = value;
    this.minSubtotal = minSubtotal;
    this.expires = expires;
    Object.freeze(this);
  }
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export class DiscountBook {
  constructor(codes = []) {
    this._codes = new Map();
    for (const code of codes) {
      this.add(code);
    }
  }

  add(code) {
    if (code.kind !== "percent" && code.kind !== "fixed") {
      throw new RangeError(`unknown discount kind: ${code.kind}`);
    }
    if (code.kind === "percent" && !(code.value > 0 && code.value <= 100)) {
      throw new RangeError("percent discount must be in (0, 100]");
    }
    this._codes.set(code.code.toUpperCase(), code);
  }

  get(code) {
    const discount = this._codes.get(code.trim().toUpperCase());
    if (discount === undefined) {
      throw new InvalidDiscount(`unknown code ${JSON.stringify(code)}`);
    }
    return discount;
  }

  /** Discount amount (cents) for `subtotal`; never more than the subtotal. */
  amount(code, subtotal, today = isoToday()) {
    const discount = this.get(code);
    if (discount.expires && today > discount.expires) {
      throw new InvalidDiscount(`code ${discount.code} expired on ${discount.expires}`);
    }
    if (subtotal < discount.minSubtotal) {
      throw new InvalidDiscount(
        `code ${discount.code} needs a subtotal of at least ${formatMoney(discount.minSubtotal)}`,
      );
    }
    const value = discount.kind === "percent" ? (subtotal * discount.value) / 100 : discount.value;
    return Math.min(value, subtotal);
  }
}

export function defaultDiscounts() {
  return new DiscountBook([
    new DiscountCode({ code: "WELCOME10", kind: "percent", value: 10 }),
    new DiscountCode({ code: "FIVEOFF", kind: "fixed", value: toCents("5.00"), minSubtotal: toCents("25.00") }),
    new DiscountCode({ code: "SPRING24", kind: "percent", value: 20, expires: "2024-05-31" }),
  ]);
}
