/** Product catalog. Prices are integer cents, weights are grams. */

import { toCents } from "./money.js";

export class UnknownProduct extends Error {
  name = "UnknownProduct";

  constructor(sku) {
    super(`unknown product ${sku}`);
    this.sku = sku;
  }
}

export class Product {
  constructor({ sku, name, price, weightGrams = 500, digital = false }) {
    this.sku = sku;
    this.name = name;
    this.price = price;
    this.weightGrams = weightGrams;
    this.digital = digital;
    Object.freeze(this);
  }
}

export class Catalog {
  constructor(products = []) {
    this._products = new Map();
    for (const product of products) {
      this.add(product);
    }
  }

  add(product) {
    if (product.price < 0) {
      throw new RangeError(`negative price for ${product.sku}`);
    }
    this._products.set(product.sku, product);
  }

  get(sku) {
    const product = this._products.get(sku);
    if (product === undefined) {
      throw new UnknownProduct(sku);
    }
    return product;
  }

  all() {
    return [...this._products.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  }

  search(text) {
    const needle = text.toLowerCase();
    return this.all().filter((p) => p.name.toLowerCase().includes(needle));
  }
}

export function defaultCatalog() {
  return new Catalog([
    new Product({ sku: "MUG-01", name: "Ceramic Mug", price: toCents("12.00"), weightGrams: 400 }),
    new Product({ sku: "TEE-01", name: "Logo T-Shirt", price: toCents("20.00"), weightGrams: 200 }),
    new Product({ sku: "BAG-01", name: "Canvas Tote", price: toCents("16.00"), weightGrams: 300 }),
    new Product({ sku: "PEN-01", name: "Gel Pen", price: toCents("2.50"), weightGrams: 20 }),
    new Product({ sku: "BOOK-01", name: "Field Notes", price: toCents("10.00"), weightGrams: 250 }),
    new Product({ sku: "EBOOK-01", name: "Style Guide (PDF)", price: toCents("8.00"), weightGrams: 0, digital: true }),
  ]);
}
