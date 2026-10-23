/** Money helpers. All amounts are integer cents; never store fractional dollars. */

export const ZERO = 0;

/** Parse a dollar string like "12.00" into integer cents (exact, no float math). */
export function toCents(value) {
  if (typeof value !== "string") {
    throw new TypeError("use a string like \"12.00\" for money, not a number");
  }
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new TypeError(`not a money amount: ${value}`);
  }
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "0").padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

/** Round a (possibly fractional) amount of cents to whole cents, half-up (accounting convention). */
export function roundMoney(amount) {
  return Math.round(Number((amount / 100).toFixed(2)) * 100);
}

export function formatMoney(cents, currency = "USD") {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${currency} ${sign}${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
