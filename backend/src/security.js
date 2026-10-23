/** Rate limiting and webhook signature checks. */

import crypto from "node:crypto";

export const SIGNATURE_HEADER = "X-Fixsi-Signature";

export function sign(secret, body) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(secret, body, header) {
  if (!secret || !header) return false;
  const expected = Buffer.from(sign(secret, body));
  const provided = Buffer.from((header.startsWith("sha256=") ? header : "sha256=" + header).trim());
  return provided.length === expected.length && crypto.timingSafeEqual(expected, provided);
}

const monotonicSeconds = () => performance.now() / 1000;

/** Sliding-window limit per key (client IP). */
export class RateLimiter {
  constructor(limit, windowSeconds = 3600, clock = monotonicSeconds) {
    this.limit = limit;
    this.window = windowSeconds;
    this.clock = clock;
    this.hits = new Map();
  }

  _trim(key) {
    const cutoff = this.clock() - this.window;
    const q = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    this.hits.set(key, q);
    return q;
  }

  /** Return [allowed, retryAfterSeconds] without recording a hit. */
  check(key) {
    const q = this._trim(key);
    if (q.length < this.limit) return [true, 0];
    return [false, Math.max(1, Math.trunc(q[0] + this.window - this.clock()))];
  }

  hit(key) {
    this._trim(key).push(this.clock());
  }
}

export function clientIp(req) {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "unknown";
}
