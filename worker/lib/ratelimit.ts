/**
 * Lightweight fixed-window rate limiter backed by Workers KV. Not a precise
 * token bucket — KV is eventually consistent — but a solid abuse deterrent for
 * auth and link creation, which aren't on the redirect hot path. All thresholds
 * are admin-configurable; a limit of 0 disables the check entirely.
 */
import type { AppBindings } from "../env";

/**
 * Record one hit against `bucket` and report whether it is now OVER `limit`
 * within the current `windowSec` window. Returns false (allowed) when the limit
 * is 0/disabled or KV is briefly unavailable — fail-open, never lock users out
 * on an infra blip.
 */
export async function isRateLimited(
  env: AppBindings,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  if (limit <= 0) return false;
  const slot = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${bucket}:${slot}`;
  try {
    const current = Number(await env.LINKS_KV.get(key)) || 0;
    if (current >= limit) return true;
    // Keep the counter a little past the window so boundary writes don't vanish.
    await env.LINKS_KV.put(key, String(current + 1), {
      expirationTtl: Math.max(60, windowSec * 2),
    });
    return false;
  } catch {
    return false;
  }
}
