/** Order pricing: promotions, discount codes, shipping and tax. All amounts are integer cents. */

import { ZERO, roundMoney } from "./money.js";
import { bulkDiscount } from "./promotions.js";

export class PricingError extends Error {
  name = "PricingError";
}

/** Tax rates in basis points (825 = 8.25%). */
export const TAX_RATES_BPS = {
  US: 825,
  CA: 1300,
  GB: 2000,
  DE: 1900,
};

export const SHIPPING_BASE = {
  US: 599,
  CA: 999,
  GB: 1250,
  DE: 1250,
};
export const FREE_SHIPPING_OVER = 7500;
export const HEAVY_PARCEL_GRAMS = 2000;
export const PER_EXTRA_KG = 150;

export function shippingCost(country, weightGrams, merchandise) {
  if (!Object.hasOwn(SHIPPING_BASE, country)) {
    throw new PricingError(`we do not ship to ${country}`);
  }
  if (merchandise >= FREE_SHIPPING_OVER) {
    return ZERO;
  }
  let cost = SHIPPING_BASE[country];
  if (weightGrams > HEAVY_PARCEL_GRAMS) {
    cost += ((weightGrams - HEAVY_PARCEL_GRAMS) * PER_EXTRA_KG) / 1000;
  }
  return roundMoney(cost);
}

export function quote(lines, country, discount = ZERO) {
  if (!Object.hasOwn(TAX_RATES_BPS, country)) {
    throw new PricingError(`no tax rate configured for ${country}`);
  }
  const merchandise = lines.reduce((sum, line) => sum + line.lineTotal, ZERO);
  const bulk = roundMoney(lines.reduce((sum, line) => sum + bulkDiscount(line), ZERO));
  const afterBulk = merchandise - bulk;
  const appliedDiscount = roundMoney(Math.min(discount, afterBulk));
  const taxable = afterBulk - appliedDiscount;
  const tax = roundMoney((taxable * TAX_RATES_BPS[country]) / 10000);
  const physical = lines.filter((line) => !line.digital);
  let shipping = ZERO;
  if (physical.length > 0) {
    const weight = physical.reduce((sum, line) => sum + line.weightGrams * line.quantity, 0);
    shipping = shippingCost(country, weight, afterBulk);
  }
  const total = roundMoney(taxable + tax + shipping);
  return Object.freeze({ merchandise, bulkSavings: bulk, discount: appliedDiscount, shipping, tax, total });
}
