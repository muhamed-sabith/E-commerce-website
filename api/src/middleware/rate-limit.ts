import type { NextFunction, Request, Response } from "express";

/**
 * Sliding-window in-memory rate limiter (API_CONTRACT §9: auth endpoints
 * 10/min/IP). Deliberately process-local — sufficient for single-node v1 and
 * the integration tests; a multi-node deployment swaps this store, not the
 * contract. Fixed window per IP per bucket; greedy consumption.
 */
interface Bucket {
  hits: number[];
}

/**
 * Per-limiter buckets (keyed by name): the login limiter must not consume
 * the register limiter's allowance. Plain map so tests can reset it.
 */
const instances = new Map<string, Map<string, Bucket>>();

/** Test seam: reset all counters between suites. */
export function resetRateLimiter(): void {
  for (const map of instances.values()) {
    map.clear();
  }
}

export function rateLimit(options: { windowMs: number; max: number; name?: string }) {
  const { windowMs, max } = options;
  const name = options.name ?? "auth";
  const buckets = instances.get(name) ?? new Map<string, Bucket>();
  instances.set(name, buckets);

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const bucket = buckets.get(ip) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

    if (bucket.hits.length >= max) {
      buckets.set(ip, bucket);
      const retryAfterSec = Math.ceil((windowMs - (now - bucket.hits[0])) / 1000);
      res.set("Retry-After", String(Math.max(1, retryAfterSec)));
      res.status(429).json({
        error: {
          code: "rate_limited",
          message: "Too many attempts. Please wait a moment and try again.",
        },
      });
      return;
    }

    bucket.hits.push(now);
    buckets.set(ip, bucket);
    next();
  };
}

