/**
 * Shared rate limiting + self-expiring abuse counters.
 *
 * Both prefer the strongly-consistent, SQLite-backed Durable Object (RATE_LIMITER,
 * Phase F) so that NEITHER rate limiting nor abuse escalation writes to Workers KV
 * on the hot path. KV's ~1k/day write budget is the binding free-tier limit and is
 * reserved for cache fills (which are write-once-read-many); a flood of login
 * attempts, API calls, failures or honeypot hits must not be able to burn it.
 *
 * KV is used only as a FALLBACK when the DO binding is absent. If KV *also*
 * fails (e.g. read quota exhausted), a last-resort in-isolate counter still
 * bounds a single-isolate flood — weak (not shared across isolates) but $0 and
 * far better than failing fully open. Only if all three are unavailable does the
 * check fail OPEN: an infra blip must never lock real users out (abuse is also
 * gated by proof-of-work + single-use tokens), and a limit of 0 disables it.
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
    // KV down/quota-exhausted → last-resort in-isolate counter (see below).
    return memoryFixedWindow(bucket, limit, windowSec);
  }
}

// Last-resort fixed-window counter held in isolate memory. Persists across
// requests within one isolate (not shared between isolates, and may reset at
// any time), so it only *bounds* a flood rather than enforcing an exact limit —
// but it costs nothing and keeps brute force from running fully unthrottled when
// both the DO and KV are unavailable.
const memCounters = new Map<string, { count: number; resetAt: number }>();

function memoryFixedWindow(bucket: string, limit: number, windowSec: number): boolean {
  const now = Date.now();
  const slot = Math.floor(now / 1000 / windowSec);
  const key = `${bucket}:${slot}`;
  const entry = memCounters.get(key);
  if (!entry || entry.resetAt <= now) {
    // New window. Opportunistically cap memory so a key flood can't grow it
    // without bound (clearing just resets the best-effort counters).
    if (memCounters.size > 5000) memCounters.clear();
    memCounters.set(key, { count: 1, resetAt: (slot + 1) * windowSec * 1000 });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

// --- Self-expiring abuse counters --------------------------------------------
// Home for the human-check's PoW escalation (`powfail:*`) and deception tallies
// (`deccount:*`). Same DO-first / KV-fallback split so a bot flood of failures or
// honeypot hits can't burn the KV write budget.

/** Current value of `key` (0 if unset/expired). `noKv` skips the KV fallback
 *  entirely (DO-only) so a counter adds ZERO KV read/write budget pressure. */
export async function counterGet(
  env: AppBindings,
  key: string,
  noKv = false,
): Promise<number> {
  const ns = rateNs(env);
  if (ns) {
    try {
      const stub = ns.get(ns.idFromName(key));
      const res = await stub.fetch(`https://rl/counter?op=get&now=${Date.now()}`);
      return ((await res.json()) as { n: number }).n;
    } catch {
      // fall through to KV (unless DO-only)
    }
  }
  if (noKv) return 0;
  try {
    return Number(await env.LINKS_KV.get(key)) || 0;
  } catch {
    return 0;
  }
}

/** Increment `key` by one and (re)set its expiry to `ttlSec` from now. `noKv`
 *  skips the KV fallback (DO-only, zero KV budget). */
export async function counterBump(
  env: AppBindings,
  key: string,
  ttlSec: number,
  noKv = false,
): Promise<void> {
  const ns = rateNs(env);
  if (ns) {
    try {
      const stub = ns.get(ns.idFromName(key));
      await stub.fetch(`https://rl/counter?op=bump&ttl=${ttlSec}&now=${Date.now()}`);
      return;
    } catch {
      // fall through to KV (unless DO-only)
    }
  }
  if (noKv) return;
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
