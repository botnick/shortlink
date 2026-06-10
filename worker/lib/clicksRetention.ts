/**
 * Click-history retention. The clicks table is the only one that grows with
 * traffic, so a daily cron purges rows older than the admin-set window
 * (`clicksRetentionDays`, 0 = keep forever). All-time per-link totals are NOT
 * lost — they live in the denormalized `links.click_count`. Recent analytics
 * ranges (24h/7d/30d/…) are served from the rows still inside the window.
 */
import { inArray, lt } from "drizzle-orm";
import { getDbHandle } from "../db";
import { clicksRetentionDaysFrom, getAllSettings } from "./settings";
import type { AppBindings } from "../env";

const DAY_MS = 86_400_000;
// Bounded per run so one tick can't lock the table or, on D1, blow the daily
// row-write budget; a backlog drains over subsequent nightly runs. The delete
// uses a `id IN (SELECT … LIMIT n)` subquery (2 bound params) so it stays under
// D1's 100-bound-parameter limit — never an inArray over a big id list.
const BATCH = 2_000;
const MAX_BATCHES = 25; // ≤ 50k rows purged per run

export async function purgeOldClicks(env: AppBindings): Promise<void> {
  const { db, schema, close } = getDbHandle(env);
  try {
    const days = clicksRetentionDaysFrom(await getAllSettings(db, schema));
    if (days <= 0) return; // retention disabled → keep everything
    const cutoff = new Date(Date.now() - days * DAY_MS);
    const { clicks } = schema;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const oldest = db
        .select({ id: clicks.id })
        .from(clicks)
        .where(lt(clicks.createdAt, cutoff))
        .limit(BATCH);
      const deleted = await db
        .delete(clicks)
        .where(inArray(clicks.id, oldest))
        .returning({ id: clicks.id });
      if (deleted.length < BATCH) break;
    }
  } finally {
    await close().catch(() => {});
  }
}
