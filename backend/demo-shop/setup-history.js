#!/usr/bin/env node
/**
 * Materialise demo-shop as a standalone git repo with a believable history.
 *
 * Git history can't be committed inside the parent Fixsi repo, so Fixsi runs this
 * at startup (and Docker runs it at build time) to create the target repo:
 *
 *     node demo-shop/setup-history.js <dest-dir>
 *
 * The final tree equals the files in this folder. Earlier commits are produced by
 * undoing later changes with exact string substitutions, so `git log -p` shows
 * real diffs — including the regression in "refactor: round prices consistently".
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.dirname(fileURLToPath(import.meta.url));
const EXCLUDE = new Set(["incidents", "setup-history.js", "node_modules", ".git"]);

const ALICE = ["Maya Chen", "maya@demo-shop.dev"];
const BOB = ["Sam Ortiz", "sam@demo-shop.dev"];

// -- older file versions, expressed as [text in final file, text in older file] --
const MONEY_PRE_REFACTOR = [
  [
    `/** Round a (possibly fractional) amount of cents to whole cents, half-up (accounting convention). */
export function roundMoney(amount) {
  return Math.round(Number((amount / 100).toFixed(2)) * 100);
}

`,
    "",
  ],
];
const PRICING_PRE_REFACTOR = [
  ['import { ZERO, roundMoney } from "./money.js";\n', 'import { ZERO } from "./money.js";\n'],
  ["  return roundMoney(cost);\n", "  return Math.round(cost);\n"],
  [
    "  const bulk = roundMoney(lines.reduce((sum, line) => sum + bulkDiscount(line), ZERO));\n",
    "  const bulk = Math.round(lines.reduce((sum, line) => sum + bulkDiscount(line), ZERO));\n",
  ],
  [
    "  const appliedDiscount = roundMoney(Math.min(discount, afterBulk));\n",
    "  const appliedDiscount = Math.round(Math.min(discount, afterBulk));\n",
  ],
  [
    "  const tax = roundMoney((taxable * TAX_RATES_BPS[country]) / 10000);\n",
    "  const tax = Math.round((taxable * TAX_RATES_BPS[country]) / 10000);\n",
  ],
  ["  const total = roundMoney(taxable + tax + shipping);\n", "  const total = Math.round(taxable + tax + shipping);\n"],
];
const PRICING_PRE_BULK = [
  ...PRICING_PRE_REFACTOR,
  ['import { bulkDiscount } from "./promotions.js";\n', ""],
  [
    "  const bulk = Math.round(lines.reduce((sum, line) => sum + bulkDiscount(line), ZERO));\n",
    "  const bulk = ZERO; // reserved for promotions\n",
  ],
];
const TEST_PRICING_PRE_BULK = [
  [
    `
test("bulk discount on large order", () => {
  const cart = new Cart(defaultCatalog());
  cart.add("PEN-01", 12); // 30.00 -> 10% off = 27.00
  const q = quote(cart.items(), "GB");
  assert.equal(q.bulkSavings, 300);
  assert.equal(q.tax, 540);
});

test("no bulk discount on small order", () => {
  const cart = new Cart(defaultCatalog());
  cart.add("PEN-01", 3);
  assert.equal(quote(cart.items(), "US").bulkSavings, 0);
});
`,
    "",
  ],
];
const CART_PRE_BUY_AGAIN = [
  [
    `  /**
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

`,
    "",
  ],
];
const ORDERS_PRE_BUY_AGAIN = [
  [
    `

  /** Load a past order's items into \`cart\` so the customer can reorder. */
  buyAgain(orderId, cart) {
    cart.restore(this.get(orderId).lines);
    return cart;
  }
`,
    "\n",
  ],
];
const README_PRE_DOCS = [["\n## Usage\n", "\n## Usage (WIP)\n"]];
const INDEX_PRE_RELEASE = [['version = "0.4.0"', 'version = "0.3.0"']];
const PACKAGE_PRE_RELEASE = [['"version": "0.4.0"', '"version": "0.3.0"']];

const COMMITS = [
  ["2026-09-21T10:04:00", ALICE, "chore: initial project skeleton",
    { ".gitignore": null, "package.json": PACKAGE_PRE_RELEASE, "README.md": README_PRE_DOCS,
      "shop/index.js": INDEX_PRE_RELEASE }],
  ["2026-09-22T15:30:00", ALICE, "feat: product catalog and money helpers",
    { "shop/products.js": null, "shop/money.js": MONEY_PRE_REFACTOR, "tests/products.test.js": null }],
  ["2026-09-24T11:12:00", BOB, "feat: inventory with reservations",
    { "shop/inventory.js": null, "tests/inventory.test.js": null }],
  ["2026-09-25T09:47:00", BOB, "feat: customers and saved addresses",
    { "shop/users.js": null, "tests/users.test.js": null }],
  ["2026-09-27T16:20:00", ALICE, "feat: shopping cart",
    { "shop/cart.js": CART_PRE_BUY_AGAIN, "tests/cart.test.js": null }],
  ["2026-09-29T13:05:00", BOB, "feat: discount codes",
    { "shop/discounts.js": null, "tests/discounts.test.js": null }],
  ["2026-10-01T10:40:00", ALICE, "feat: shipping and tax pricing",
    { "shop/pricing.js": PRICING_PRE_BULK, "tests/pricing.test.js": TEST_PRICING_PRE_BULK }],
  ["2026-10-03T17:55:00", BOB, "feat: checkout, cancellation and fulfilment",
    { "shop/orders.js": ORDERS_PRE_BUY_AGAIN, "tests/helpers.js": null, "tests/orders.test.js": null }],
  ["2026-10-07T12:10:00", ALICE, "feat: bulk-buy promotion (10+ units, 10% off)",
    { "shop/promotions.js": null, "shop/pricing.js": PRICING_PRE_REFACTOR, "tests/pricing.test.js": null }],
  ["2026-10-09T14:33:00", BOB, "feat: 'Buy again' on past orders",
    { "shop/cart.js": null, "shop/orders.js": null }],
  ["2026-10-12T09:21:00", ALICE, "docs: usage examples in README",
    { "README.md": null }],
  ["2026-10-15T18:02:00", BOB, "refactor: round prices consistently",
    { "shop/money.js": null, "shop/pricing.js": null }],
  ["2026-10-16T07:45:00", ALICE, "chore: release v0.4.0",
    { "shop/index.js": null, "package.json": null }],
];

function read(rel) {
  // Normalise line endings so a Windows checkout produces the same history.
  return fs.readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
}

function older(rel, subs) {
  let text = read(rel);
  for (const [final, old] of subs ?? []) {
    if (!text.includes(final)) {
      throw new Error(`setup-history: substitution not found in ${rel}: ${JSON.stringify(final.slice(0, 60))}`);
    }
    text = text.replace(final, () => old);
  }
  return text;
}

function git(dest, args, env) {
  execFileSync("git", args, { cwd: dest, env: env ?? process.env, stdio: "pipe" });
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

export function build(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  git(dest, ["init", "-q", "-b", "main"]);
  git(dest, ["config", "user.name", "demo-shop"]);
  git(dest, ["config", "user.email", "dev@demo-shop.dev"]);
  git(dest, ["config", "commit.gpgsign", "false"]);
  git(dest, ["config", "core.autocrlf", "false"]);
  for (const [when, [name, email], message, files] of COMMITS) {
    for (const [rel, subs] of Object.entries(files)) {
      const target = path.join(dest, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, older(rel, subs));
      git(dest, ["add", rel]);
    }
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: when,
    };
    git(dest, ["commit", "-q", "-m", message], env);
  }

  // The last commit must reproduce the source tree exactly.
  for (const rel of walk(SRC)) {
    const target = path.join(dest, rel);
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== read(rel)) {
      throw new Error(`setup-history: ${rel} differs from source; add it to COMMITS`);
    }
  }
  return COMMITS.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error("usage: setup-history.js <dest-dir>");
    process.exit(2);
  }
  const dest = path.resolve(process.argv[2]);
  const n = build(dest);
  console.log(`demo-shop repo with ${n} commits created at ${dest}`);
}
