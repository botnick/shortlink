/**
 * Phase F — exact rate-limit counter as a SQLite-backed Durable Object.
 *
 * Why a DO and not KV: KV is eventually consistent, so two requests racing on
 * the same counter can both read "under the limit" and both pass — the limit
 * leaks under a burst, which is exactly when it matters. A Durable Object is a
 * single, strongly-consistent instance per key; the runtime SERIALIZES calls to
 * it (input gates), so the read-refill-write below is race-free and the limit is
 * exact. The token-bucket maths lives in a pure, unit-tested helper.
 *
 * Cost ($0): SQLite-backed DOs are on the Workers Free plan. Each idle bucket
 * self-deletes via an alarm, so storage stays bounded no matter how many unique
 * IPs pass through. Usage is OPTIONAL — the worker falls back to the KV limiter
 * when this binding isn't configured.
 *
 * Implemented in the classic `fetch`-RPC style ON PURPOSE: it avoids importing
 * `cloudflare:workers`, which doesn't exist under Node, so the worker entry
 * (which re-exports this class) stays importable by the tsx test harness. The
 * Durable Object types used here are ambient globals — no import needed.
 */
import { takeToken, type BucketState } from "../lib/captcha/tokenBucket";

const IDLE_TTL_MS = 3_600_000; // delete a bucket after an hour with no traffic

export class RateLimiter {
  private readonly storage: DurableObjectStorage;

  constructor(state: DurableObjectState) {
    this.storage = state.storage;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/counter") return this.counter(url);
    return this.take(url);
  }

  /** GET /take?cap=<n>&refill=<perSec>&now=<ms> → { allowed: boolean }. */
  private async take(url: URL): Promise<Response> {
    const capacity = Number(url.searchParams.get("cap"));
    const refillPerSec = Number(url.searchParams.get("refill"));
    const nowMs = Number(url.searchParams.get("now"));
    if (!Number.isFinite(capacity) || !Number.isFinite(refillPerSec) || !Number.isFinite(nowMs)) {
      return Response.json({ allowed: true }); // malformed → don't lock anyone out
    }
    const prev = (await this.storage.get<BucketState>("b")) ?? null;
    const { allowed, state } = takeToken(prev, { cost: 1, capacity, refillPerSec, nowMs });
    await this.storage.put("b", state);
    // Keep pushing the cleanup alarm out while the bucket sees traffic.
    await this.storage.setAlarm(nowMs + IDLE_TTL_MS);
    return Response.json({ allowed });
  }

  /**
   * An exact, self-expiring abuse counter — the home for the human-check's
   * proof-of-work escalation (`powfail:*`) and deception tallies (`deccount:*`),
   * moved off KV so a bot flood can't burn the KV daily write budget. SQLite DO
   * writes are on the free plan with far more headroom, strongly consistent, and
   * only touched on a failure/trap (attackers, already rate-limited) or a mint.
   *
   * GET /counter?op=get|bump|max&now=<ms>[&by=<n>][&cap=<n>][&ttl=<sec>] → { n }.
   * Each bump/max refreshes the expiry; an alarm drops the row when it lapses.
   */
  private async counter(url: URL): Promise<Response> {
    const op = url.searchParams.get("op");
    const now = Number(url.searchParams.get("now")) || 0;
    const cur = (await this.storage.get<{ n: number; exp: number }>("c")) ?? null;
    const live = cur && cur.exp > now ? cur.n : 0; // expired → treated as zero
    if (op === "get") return Response.json({ n: live });

    const ttlMs = (Number(url.searchParams.get("ttl")) || 3600) * 1000;
    let n = live;
    if (op === "bump") n = live + (Number(url.searchParams.get("by")) || 1);
    else if (op === "max") n = Number(url.searchParams.get("cap")) || live;
    else return Response.json({ n: live });

    const exp = now + ttlMs;
    await this.storage.put("c", { n, exp });
    await this.storage.setAlarm(exp);
    return Response.json({ n });
  }

  /** Idle for IDLE_TTL_MS → drop all state so the DO can be reclaimed. */
  async alarm(): Promise<void> {
    await this.storage.deleteAll();
  }
}
