import {
  type SQL,
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DB, DbSchema, Dialect } from "../db";
import { dayBucket } from "../lib/query";
import type { AdminAnalyticsDTO, NameCount, StatsDTO } from "@shared/types";

export type Range = "24h" | "7d" | "30d" | "90d" | "all";
const RANGES: Range[] = ["24h", "7d", "30d", "90d", "all"];
const DAY_MS = 86_400_000;

export function parseRange(value: string | undefined): Range {
  return RANGES.includes(value as Range) ? (value as Range) : "7d";
}

function rangeStart(range: Range): Date | null {
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
): Promise<StatsDTO> {
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

  // Day bucket is the only dialect-specific bit. Comparisons use the query
  // builder (gte/isNull) so Drizzle serialises Dates correctly per driver.
  const dayExpr =
    dialect === "sqlite"
      ? sql<string>`strftime('%Y-%m-%d', ${clicks.createdAt}, 'unixepoch')`
      : sql<string>`to_char(date_trunc('day', ${clicks.createdAt}), 'YYYY-MM-DD')`;

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
): Promise<AdminAnalyticsDTO> {
  const { clicks, links, users } = schema;
  const start = rangeStart(range);
  const human = sql`${clicks.isBot} is not true`;
  const base: SQL = start ? (and(gte(clicks.createdAt, start), human) as SQL) : human;
  const dayExpr = dayBucket(dialect, sql`${clicks.createdAt}`);

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
    totalClicks: Number(totals[0]?.total ?? 0),
    uniqueVisitors: Number(totals[0]?.unique ?? 0),
    timeseries: series.map((r) => ({ day: r.day, count: Number(r.value) })),
    countries,
    referrers,
    devices,
    browsers,
    os: oss,
    topLinks: top.map((t) => ({
      slug: t.slug,
      clickCount: t.clickCount,
      ownerEmail: t.ownerEmail,
    })),
  };
}
