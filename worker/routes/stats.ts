import {
  type SQL,
  and,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DB, DbSchema, Dialect } from "../db";
import { dayBucket, timeBucket } from "../lib/query";
import type { AdminAnalyticsDTO, NameCount, StatsDTO } from "@shared/types";

type Range = "24h" | "7d" | "30d" | "90d" | "all";
const RANGES: Range[] = ["24h", "7d", "30d", "90d", "all"];
const DAY_MS = 86_400_000;

export function parseRange(value: string | undefined): Range {
  return RANGES.includes(value as Range) ? (value as Range) : "7d";
}

export function rangeStart(range: Range): Date | null {
  const now = Date.now();
  switch (range) {
    case "24h":
      return new Date(now - DAY_MS);
    case "7d":
      return new Date(now - 7 * DAY_MS);
    case "30d":
      return new Date(now - 30 * DAY_MS);
    case "90d":
      return new Date(now - 90 * DAY_MS);
    case "all":
      return null;
  }
}

async function topList(
  db: DB,
  table: DbSchema["clicks"],
  base: SQL,
  col: AnyPgColumn,
  limit = 12,
): Promise<NameCount[]> {
  const rows = await db
    .select({ name: col, value: count() })
    .from(table)
    .where(and(base, isNotNull(col)))
    .groupBy(col)
    .orderBy(desc(count()))
    .limit(limit);
  return rows.map((r) => ({
    name: (r.name as string | null) ?? "Unknown",
    count: Number(r.value),
  }));
}

export async function computeStats(
  db: DB,
  schema: DbSchema,
  dialect: Dialect,
  linkId: string,
  range: Range,
  createdAt: Date,
  useRollups = false,
): Promise<StatsDTO> {
  if (useRollups) return computeStatsFromRollups(db, schema, linkId, range, createdAt);
  const { clicks } = schema;
  const start = rangeStart(range);
  // Analytics count humans only — bot rows are kept but filtered out here.
  // "is not true" also covers legacy rows where is_bot is null.
  const human = sql`${clicks.isBot} is not true`;
  const link = and(eq(clicks.linkId, linkId), human) as SQL;
  const base: SQL = start ? (and(link, gte(clicks.createdAt, start)) as SQL) : link;
  const botCond = and(
    eq(clicks.linkId, linkId),
    eq(clicks.isBot, true),
    ...(start ? [gte(clicks.createdAt, start)] : []),
  ) as SQL;

  // Time buckets are the only dialect-specific bit. Comparisons use the query
  // builder (gte/isNull) so Drizzle serialises Dates correctly per driver.
  // The series buckets adapt to the range (hourly for 24h); bestDay stays daily.
  const { expr: seriesExpr, granularity } = timeBucket(
    dialect,
    sql`${clicks.createdAt}`,
    range,
  );
  const dayExpr = dayBucket(dialect, sql`${clicks.createdAt}`);

  const windowCount = (ms: number) =>
    db
      .select({ v: count() })
      .from(clicks)
      .where(and(link, gte(clicks.createdAt, new Date(Date.now() - ms))))
      .then((r) => Number(r[0]?.v ?? 0));

  const [
    totals,
    series,
    countries,
    referrers,
    devices,
    browsers,
    operatingSystems,
    last24h,
    last7d,
    last30d,
    allTime,
    best,
    directRows,
    referrerRows,
    botClicks,
  ] = await Promise.all([
    db
      .select({ total: count(), unique: countDistinct(clicks.ipHash) })
      .from(clicks)
      .where(base),
    db
      .select({ day: seriesExpr, value: count() })
      .from(clicks)
      .where(base)
      .groupBy(seriesExpr)
      .orderBy(seriesExpr),
    topList(db, clicks, base, clicks.country),
    topList(db, clicks, base, clicks.referrer),
    topList(db, clicks, base, clicks.deviceType),
    topList(db, clicks, base, clicks.browser),
    topList(db, clicks, base, clicks.os),
    windowCount(DAY_MS),
    windowCount(7 * DAY_MS),
    windowCount(30 * DAY_MS),
    db.select({ v: count() }).from(clicks).where(link).then((r) => Number(r[0]?.v ?? 0)),
    db
      .select({ day: dayExpr, value: count() })
      .from(clicks)
      .where(link)
      .groupBy(dayExpr)
      .orderBy(desc(count()))
      .limit(1),
    db
      .select({ v: count() })
      .from(clicks)
      .where(and(base, isNull(clicks.referrer)))
      .then((r) => Number(r[0]?.v ?? 0)),
    db
      .select({ v: count() })
      .from(clicks)
      .where(and(base, isNotNull(clicks.referrer)))
      .then((r) => Number(r[0]?.v ?? 0)),
    db
      .select({ v: count() })
      .from(clicks)
      .where(botCond)
      .then((r) => Number(r[0]?.v ?? 0)),
  ]);

  const b = best[0];

  return {
    range,
    granularity,
    createdAt: createdAt.toISOString(),
    totalClicks: Number(totals[0]?.total ?? 0),
    uniqueVisitors: Number(totals[0]?.unique ?? 0),
    windows: { last24h, last7d, last30d, allTime },
    bestDay: b ? { day: b.day, count: Number(b.value) } : null,
    directClicks: directRows,
    referrerClicks: referrerRows,
    botClicks,
    timeseries: series.map((r) => ({ day: r.day, count: Number(r.value) })),
    countries,
    referrers,
    devices,
    browsers,
    os: operatingSystems,
  };
}

/**
 * System-wide analytics for the admin Analytics tab. Range-scoped breakdowns
 * come from the clicks table; "top links" uses the denormalized click_count
 * (all-time) to avoid a full clicks scan, keeping Worker CPU low.
 */
export async function computeGlobalStats(
  db: DB,
  schema: DbSchema,
  dialect: Dialect,
  range: Range,
  useRollups = false,
): Promise<AdminAnalyticsDTO> {
  if (useRollups) return computeGlobalStatsFromRollups(db, schema, range);
  const { clicks, links, users } = schema;
  const start = rangeStart(range);
  const human = sql`${clicks.isBot} is not true`;
  const base: SQL = start ? (and(gte(clicks.createdAt, start), human) as SQL) : human;
  const { expr: dayExpr, granularity } = timeBucket(dialect, sql`${clicks.createdAt}`, range);

  const [totals, series, countries, referrers, devices, browsers, oss, top] =
    await Promise.all([
      db
        .select({ total: count(), unique: countDistinct(clicks.ipHash) })
        .from(clicks)
        .where(base),
      db
        .select({ day: dayExpr, value: count() })
        .from(clicks)
        .where(base)
        .groupBy(dayExpr)
        .orderBy(dayExpr),
      topList(db, clicks, base, clicks.country),
      topList(db, clicks, base, clicks.referrer),
      topList(db, clicks, base, clicks.deviceType),
      topList(db, clicks, base, clicks.browser),
      topList(db, clicks, base, clicks.os),
      db
        .select({
          id: links.id,
          slug: links.slug,
          clickCount: links.clickCount,
          ownerEmail: users.email,
        })
        .from(links)
        .innerJoin(users, eq(links.userId, users.id))
        .orderBy(desc(links.clickCount))
        .limit(10),
    ]);

  return {
    range,
    granularity,
    totalClicks: Number(totals[0]?.total ?? 0),
    uniqueVisitors: Number(totals[0]?.unique ?? 0),
    timeseries: series.map((r) => ({ day: r.day, count: Number(r.value) })),
    countries,
    referrers,
    devices,
    browsers,
    os: oss,
    topLinks: top.map((t) => ({
      id: t.id,
      slug: t.slug,
      clickCount: t.clickCount,
      ownerEmail: t.ownerEmail,
    })),
  };
}

// --- Rollup-mode analytics (D1 only) ---------------------------------------
// Read pre-aggregated counts from click_rollups instead of raw clicks. The
// hourly `bucket` integer is turned back into epoch seconds (×3600) and fed
// through the SAME sqlite time-bucket SQL, so the chart labels match the raw
// path exactly. Unique visitors aren't available from aggregates → reported as
// 0 with uniquesTracked:false so the UI shows "—".
const HOUR_MS = 3_600_000;

function startBucket(range: Range): number | null {
  const s = rangeStart(range);
  return s ? Math.floor(s.getTime() / HOUR_MS) : null;
}

async function topListRollup(
  db: DB,
  table: DbSchema["clickRollups"],
  base: SQL,
  col: AnyPgColumn,
): Promise<NameCount[]> {
  const total = sql<number>`sum(${table.count})`;
  const rows = await db
    .select({ name: col, value: total })
    .from(table)
    .where(and(base, ne(col, "")))
    .groupBy(col)
    .orderBy(desc(total))
    .limit(12);
  return rows.map((r) => ({ name: (r.name as string | null) || "Unknown", count: Number(r.value) }));
}

async function computeStatsFromRollups(
  db: DB,
  schema: DbSchema,
  linkId: string,
  range: Range,
  createdAt: Date,
): Promise<StatsDTO> {
  const r = schema.clickRollups;
  const total = sql<number>`coalesce(sum(${r.count}), 0)`;
  const sb = startBucket(range);
  const link = and(eq(r.linkId, linkId), eq(r.isBot, false)) as SQL;
  const base: SQL = sb !== null ? (and(link, gte(r.bucket, sb)) as SQL) : link;
  const botCond = and(
    eq(r.linkId, linkId),
    eq(r.isBot, true),
    ...(sb !== null ? [gte(r.bucket, sb)] : []),
  ) as SQL;

  const tsCol = sql`${r.bucket} * 3600`;
  const { expr: seriesExpr, granularity } = timeBucket("sqlite", tsCol, range);
  const dayExpr = dayBucket("sqlite", tsCol);
  const nowBucket = Math.floor(Date.now() / HOUR_MS);
  // The most recent N full hourly buckets (gt, not gte, so "last 24h" is 24
  // buckets — not 25 from including the boundary hour).
  const windowCount = (hours: number) =>
    db
      .select({ v: total })
      .from(r)
      .where(and(link, gt(r.bucket, nowBucket - hours)))
      .then((x) => Number(x[0]?.v ?? 0));

  const [
    totals,
    series,
    countries,
    referrers,
    devices,
    browsers,
    oss,
    last24h,
    last7d,
    last30d,
    allTime,
    best,
    direct,
    referred,
    bot,
  ] = await Promise.all([
    db.select({ total }).from(r).where(base),
    db.select({ day: seriesExpr, value: total }).from(r).where(base).groupBy(seriesExpr).orderBy(seriesExpr),
    topListRollup(db, r, base, r.country),
    topListRollup(db, r, base, r.referrerDomain),
    topListRollup(db, r, base, r.deviceType),
    topListRollup(db, r, base, r.browser),
    topListRollup(db, r, base, r.os),
    windowCount(24),
    windowCount(7 * 24),
    windowCount(30 * 24),
    db.select({ v: total }).from(r).where(link).then((x) => Number(x[0]?.v ?? 0)),
    db.select({ day: dayExpr, value: total }).from(r).where(link).groupBy(dayExpr).orderBy(desc(total)).limit(1),
    db.select({ v: total }).from(r).where(and(base, eq(r.referrerDomain, ""))).then((x) => Number(x[0]?.v ?? 0)),
    db.select({ v: total }).from(r).where(and(base, ne(r.referrerDomain, ""))).then((x) => Number(x[0]?.v ?? 0)),
    db.select({ v: total }).from(r).where(botCond).then((x) => Number(x[0]?.v ?? 0)),
  ]);

  const b = best[0];
  return {
    range,
    granularity,
    createdAt: createdAt.toISOString(),
    totalClicks: Number(totals[0]?.total ?? 0),
    uniqueVisitors: 0,
    uniquesTracked: false,
    windows: { last24h, last7d, last30d, allTime },
    bestDay: b ? { day: b.day as string, count: Number(b.value) } : null,
    directClicks: direct,
    referrerClicks: referred,
    botClicks: bot,
    timeseries: series.map((x) => ({ day: x.day as string, count: Number(x.value) })),
    countries,
    referrers,
    devices,
    browsers,
    os: oss,
  };
}

async function computeGlobalStatsFromRollups(
  db: DB,
  schema: DbSchema,
  range: Range,
): Promise<AdminAnalyticsDTO> {
  const r = schema.clickRollups;
  const { links, users } = schema;
  const total = sql<number>`coalesce(sum(${r.count}), 0)`;
  const sb = startBucket(range);
  const base: SQL =
    sb !== null ? (and(eq(r.isBot, false), gte(r.bucket, sb)) as SQL) : (eq(r.isBot, false) as SQL);
  const tsCol = sql`${r.bucket} * 3600`;
  const { expr: dayExpr, granularity } = timeBucket("sqlite", tsCol, range);

  const [totals, series, countries, referrers, devices, browsers, oss, top] = await Promise.all([
    db.select({ total }).from(r).where(base),
    db.select({ day: dayExpr, value: total }).from(r).where(base).groupBy(dayExpr).orderBy(dayExpr),
    topListRollup(db, r, base, r.country),
    topListRollup(db, r, base, r.referrerDomain),
    topListRollup(db, r, base, r.deviceType),
    topListRollup(db, r, base, r.browser),
    topListRollup(db, r, base, r.os),
    db
      .select({ id: links.id, slug: links.slug, clickCount: links.clickCount, ownerEmail: users.email })
      .from(links)
      .innerJoin(users, eq(links.userId, users.id))
      .orderBy(desc(links.clickCount))
      .limit(10),
  ]);

  return {
    range,
    granularity,
    totalClicks: Number(totals[0]?.total ?? 0),
    uniqueVisitors: 0,
    uniquesTracked: false,
    timeseries: series.map((x) => ({ day: x.day as string, count: Number(x.value) })),
    countries,
    referrers,
    devices,
    browsers,
    os: oss,
    topLinks: top.map((t) => ({
      id: t.id,
      slug: t.slug,
      clickCount: t.clickCount,
      ownerEmail: t.ownerEmail,
    })),
  };
}
