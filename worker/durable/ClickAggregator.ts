/**
 * Click aggregator for "rollup" logging mode — the scale path.
 *
 * Instead of one D1 row per click (which burns D1's daily rows-written budget
 * under heavy traffic), the redirect hot path fires a fire-and-forget RPC at
 * this Durable Object, sharded per link (`idFromName(linkId)`). The DO tallies
 * clicks by (hour bucket × dimensions) and, on a ~60s alarm, flushes them to
 * `click_rollups` as ONE batched upsert per bucket-combo plus a single summed
 * `links.click_count` bump. So a million clicks become a handful of writes —
 * and it costs nothing extra (SQLite-backed DOs + the D1 binding are Free plan,
 * no API token).
 *
 * Durability: tallies are persisted to DO storage on every record (free,
 * strongly-consistent, NOT a D1 write), so an eviction before the alarm doesn't
 * drop counts — a fresh instance reads them back. After a successful flush each
 * key is decremented by exactly the amount flushed (not deleted), so clicks that
 * arrive during the D1 round-trip aren't lost. A flush failure (e.g. the link
 * was deleted → FK violation) retries a few times, then drops the tally so it
 * can't loop forever. Only used on D1; Postgres installs log raw.
 *
 * Classic fetch-RPC style (no `cloudflare:workers` import) so the worker entry
 * stays importable by the tsx test harness — matches RateLimiter.
 */
import type { AppBindings } from "../env";

const FLUSH_MS = 60_000;
const MAX_RETRIES = 3;
const SEP = "\u0001"; // record separator — never appears in dimension values
const PREFIX = "t:"; // tally keys; other keys (linkId, retry) are bookkeeping

const clip = (s: string | null, n: number): string => (s ?? "").slice(0, n);

export class ClickAggregator {
  private readonly storage: DurableObjectStorage;
  private readonly env: AppBindings;

  constructor(state: DurableObjectState, env: AppBindings) {
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const p = new URL(req.url).searchParams;
    const linkId = p.get("linkId") || "";
    const bucket = Math.floor(Number(p.get("bucket")));
    // Internal RPC, but validate anyway — a bad id/bucket would poison the flush.
    if (!/^[0-9a-fA-F-]{36}$/.test(linkId) || !Number.isFinite(bucket) || bucket <= 0) {
      return new Response(null, { status: 204 });
    }
    // Dimension values are capped (referrerDomain especially) to bound key size.
    const key =
      PREFIX +
      [
        bucket,
        clip(p.get("country"), 8),
        clip(p.get("ref"), 120),
        clip(p.get("browser"), 40),
        clip(p.get("os"), 40),
        clip(p.get("device"), 24),
        p.get("bot") === "1" ? "1" : "0",
      ].join(SEP);

    await this.storage.put("linkId", linkId);
    const cur = (await this.storage.get<number>(key)) ?? 0;
    await this.storage.put(key, cur + 1);
    if ((await this.storage.getAlarm()) === null) {
      await this.storage.setAlarm(Date.now() + FLUSH_MS);
    }
    return new Response(null, { status: 204 });
  }

  async alarm(): Promise<void> {
    const linkId = (await this.storage.get<string>("linkId")) ?? "";
    const tally = await this.storage.list<number>({ prefix: PREFIX });
    if (!linkId || tally.size === 0) {
      await this.storage.deleteAll();
      return;
    }

    let humanTotal = 0;
    const stmts: D1PreparedStatement[] = [];
    for (const [key, n] of tally) {
      const [bucket, country, ref, browser, os, device, bot] = key.slice(PREFIX.length).split(SEP);
      const isBot = bot === "1";
      if (!isBot) humanTotal += n;
      stmts.push(
        this.env.DB.prepare(
          `INSERT INTO click_rollups
             (link_id, bucket, country, referrer_domain, browser, os, device_type, is_bot, count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(link_id, bucket, country, referrer_domain, browser, os, device_type, is_bot)
           DO UPDATE SET count = count + excluded.count`,
        ).bind(linkId, Number(bucket), country, ref, browser, os, device, isBot ? 1 : 0, n),
      );
    }
    if (humanTotal > 0) {
      stmts.push(
        this.env.DB.prepare(`UPDATE links SET click_count = click_count + ? WHERE id = ?`).bind(
          humanTotal,
          linkId,
        ),
      );
    }

    try {
      await this.env.DB.batch(stmts);
    } catch {
      // A transient error retries; a permanent one (link deleted → FK violation)
      // would loop forever, so give up after a few tries and drop the tally.
      const retry = ((await this.storage.get<number>("retry")) ?? 0) + 1;
      if (retry > MAX_RETRIES) {
        await this.storage.deleteAll();
        return;
      }
      await this.storage.put("retry", retry);
      await this.storage.setAlarm(Date.now() + FLUSH_MS);
      return;
    }

    // Success: subtract exactly what was flushed (don't delete) so clicks that
    // arrived during the D1 round-trip survive. Reschedule if any remain.
    let remaining = 0;
    for (const [key, flushed] of tally) {
      const now = (await this.storage.get<number>(key)) ?? 0;
      const rem = now - flushed;
      if (rem > 0) {
        await this.storage.put(key, rem);
        remaining += rem;
      } else {
        await this.storage.delete(key);
      }
    }
    await this.storage.delete("retry");
    if (remaining > 0) await this.storage.setAlarm(Date.now() + FLUSH_MS);
  }
}
