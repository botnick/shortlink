/**
 * Shared rate limiting + self-expiring abuse counters.
 *
 * Both prefer the strongly-consistent, SQLite-backed Durable Object (RATE_LIMITER,
 * Phase F) so that NEITHER rate limiting nor abuse escalation writes to Workers KV
 * on the hot path. KV's ~1k/day write budget is the binding free-tier limit and is
 * reserved for cache fills (which are write-once-read-many); a flood of login
 * attempts, API calls, failures or honeypot hits must not be able to burn it.
 *
 * KV is used only as a FALLBACK when the DO binding is absent, and every path
 * fails OPEN: an infra blip must never lock real users out (abuse is still gated
 * by proof-of-work + single-use tokens), and a limit of 0 disables the check.
 */
import type { AppBindings } from "../env";

interface DOStub {
  fetch(input: string): Promise<Response>;
}
interface DONamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DOStub;
}

function rateNs(env: AppBindings): DONamespace | null {
  return (env as unknown as { RATE_LIMITER?: DONamespace }).RATE_LIMITER ?? null;
}

/**
 * Record one hit against `bucket` and report whether it is now OVER `limit`
 * within `windowSec`. Uses the DO token bucket when available (exact, race-free,
 * zero KV writes); otherwise a KV fixed-window counter. Fail-open.
 */
export async function isRateLimited(
  env: AppBindings,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  if (limit <= 0) return false;
  const ns = rateNs(env);
  if (ns) {
    try {
      const stub = ns.get(ns.idFromName(bucket));
      const refill = limit / windowSec;
      const res = await stub.fetch(
        `https://rl/take?cap=${limit}&refill=${refill}&now=${Date.now()}`,
      );
      const { allowed } = (await res.json()) as { allowed: boolean };
      return !allowed;
    } catch {
      // DO unavailable → fall back to the KV limiter below.
    }
  }
  return kvFixedWindow(env, bucket, limit, windowSec);
}

async function kvFixedWindow(
  env: AppBindings,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
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

// --- Self-expiring abuse counters --------------------------------------------
// Home for the human-check's PoW escalation (`powfail:*`) and deception tallies
// (`deccount:*`). Same DO-first / KV-fallback split so a bot flood of failures or
// honeypot hits can't burn the KV write budget.

/** Current value of `key` (0 if unset/expired). */
export async function counterGet(env: AppBindings, key: string): Promise<number> {
  const ns = rateNs(env);
  if (ns) {
    try {
      const stub = ns.get(ns.idFromName(key));
      const res = await stub.fetch(`https://rl/counter?op=get&now=${Date.now()}`);
      return ((await res.json()) as { n: number }).n;
    } catch {
      // fall through to KV
    }
  }
  try {
    return Number(await env.LINKS_KV.get(key)) || 0;
  } catch {
    return 0;
  }
}

/** Increment `key` by one and (re)set its expiry to `ttlSec` from now. */
export async function counterBump(
  env: AppBindings,
  key: string,
  ttlSec: number,
): Promise<void> {
  const ns = rateNs(env);
  if (ns) {
    try {
      const stub = ns.get(ns.idFromName(key));
      await stub.fetch(`https://rl/counter?op=bump&ttl=${ttlSec}&now=${Date.now()}`);
      return;
    } catch {
      // fall through to KV
    }
  }
  try {
    const n = Number(await env.LINKS_KV.get(key)) || 0;
    await env.LINKS_KV.put(key, String(n + 1), { expirationTtl: ttlSec });
  } catch {
    // best-effort — escalation is advisory, never blocks the response.
  }
}

/** Pin `key` to `value` (a ceiling, e.g. a honeypot jump) with a `ttlSec` expiry. */
export async function counterMax(
  env: AppBindings,
  key: string,
  value: number,
  ttlSec: number,
): Promise<void> {
  const ns = rateNs(env);
  if (ns) {
    try {
      const stub = ns.get(ns.idFromName(key));
      await stub.fetch(`https://rl/counter?op=max&cap=${value}&ttl=${ttlSec}&now=${Date.now()}`);
      return;
    } catch {
      // fall through to KV
    }
  }
  try {
    await env.LINKS_KV.put(key, String(value), { expirationTtl: ttlSec });
  } catch {
    // best-effort
  }
}
