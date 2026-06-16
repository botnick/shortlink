/**
 * Phase F — exact token-bucket logic, kept as a PURE function so it can be unit
 * tested without a live Durable Object. The DO (worker/durable/RateLimiter.ts)
 * is just a thin, strongly-consistent wrapper around this: it reads the stored
 * bucket, calls takeToken, and writes the new state back — and because a DO
 * serializes calls to one instance (input gates), the read-modify-write is
 * race-free, which is exactly what KV (eventually consistent) cannot guarantee.
 */
export interface BucketState {
  tokens: number;
  ts: number; // epoch ms of the last update
}

interface TakeResult {
  allowed: boolean;
  state: BucketState;
}

/**
 * Refill then attempt to spend `cost` tokens.
 * - capacity: max tokens (burst ceiling)
 * - refillPerSec: tokens added per second (set to limit/windowSec for "limit per window")
 */
export function takeToken(
  prev: BucketState | null,
  opts: { cost: number; capacity: number; refillPerSec: number; nowMs: number },
): TakeResult {
  const { cost, capacity, refillPerSec, nowMs } = opts;
  const base = prev ?? { tokens: capacity, ts: nowMs };
  const elapsedSec = Math.max(0, nowMs - base.ts) / 1000;
  const refilled = Math.min(capacity, base.tokens + elapsedSec * refillPerSec);
  if (refilled < cost) {
    return { allowed: false, state: { tokens: refilled, ts: nowMs } };
  }
  return { allowed: true, state: { tokens: refilled - cost, ts: nowMs } };
}
