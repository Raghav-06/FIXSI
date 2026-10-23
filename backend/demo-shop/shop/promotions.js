/** Automatic promotions applied at pricing time. */

export const BULK_THRESHOLD = 10;
export const BULK_RATE_PERCENT = 10;

/** Bulk-buy promotion: 10% off a line when its quantity is 10 or more. Returns cents. */
export function bulkDiscount(line) {
  if (line.quantity > BULK_THRESHOLD) {
    return (line.lineTotal * BULK_RATE_PERCENT) / 100;
  }
  return 0;
}
