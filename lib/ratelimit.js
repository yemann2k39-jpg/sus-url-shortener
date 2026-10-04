/**
 * In-memory per-IP fixed-window rate limiter.
 *
 * Pure JS on purpose: no Node built-ins, so both route handlers (Node
 * runtime) and middleware (edge runtime) can import it.
 *
 * Scope: per server instance. Multiple instances would each keep their own
 * buckets - swap this module for a Redis-backed implementation when the
 * app runs distributed. See README "Path to scale".
 */

const buckets = new Map();

function envInt(name, fallback) {
  const v = Number.parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Expired buckets are dead weight; prune them at most once a minute.
let lastPrune = Date.now();
function prune(now) {
  if (now - lastPrune < 60000) return;
  lastPrune = now;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  prune(now);

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, remaining: 0, resetAt: bucket.resetAt };
  }
  return { ok: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

export const LIMITS = {
  create: {
    limit: envInt("RATE_LIMIT_CREATE", 20),
    windowMs: envInt("RATE_LIMIT_CREATE_WINDOW_MS", 10 * 60 * 1000),
  },
  remove: {
    limit: envInt("RATE_LIMIT_DELETE", 30),
    windowMs: envInt("RATE_LIMIT_DELETE_WINDOW_MS", 10 * 60 * 1000),
  },
  hit: {
    limit: envInt("RATE_LIMIT_HIT", 120),
    windowMs: envInt("RATE_LIMIT_HIT_WINDOW_MS", 60 * 1000),
  },
};

export function clientKeyFromHeaders(headers, fallback = "local") {
  const forwarded = headers?.get?.("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return fallback;
}
