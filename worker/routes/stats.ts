import {
  type SQL,
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  isNotNull,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { clicks } from "../db/schema";
import type { DB } from "../db";
import type { NameCount, StatsDTO } from "@shared/types";

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
  base: SQL,
  col: AnyPgColumn,
  limit = 12,
): Promise<NameCount[]> {
  const rows = await db
    .select({ name: col, value: count() })
    .from(clicks)
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
  linkId: string,
  range: Range,
  createdAt: Date,
): Promise<StatsDTO> {
  const start = rangeStart(range);
  const base: SQL = start
    ? (and(eq(clicks.linkId, linkId), gte(clicks.createdAt, start)) as SQL)
    : eq(clicks.linkId, linkId);

  const dayExpr = sql<string>`to_char(date_trunc('day', ${clicks.createdAt}), 'YYYY-MM-DD')`;
  const now = Date.now();
  // postgres.js can't serialize a bare Date param inside a raw `sql` fragment
  // (no type info → ERR_INVALID_ARG_TYPE). Pass an ISO string + explicit cast.
  const since = (ms: number) =>
    sql<number>`count(*) filter (where ${clicks.createdAt} >= ${new Date(now - ms).toISOString()}::timestamptz)`.mapWith(
      Number,
    );

  const [
    totals,
    series,
    countries,
    referrers,
    devices,
    browsers,
    operatingSystems,
    windows,
    best,
    split,
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
    topList(db, base, clicks.country),
    topList(db, base, clicks.referrer),
    topList(db, base, clicks.deviceType),
    topList(db, base, clicks.browser),
    topList(db, base, clicks.os),
    db
      .select({
        last24h: since(DAY_MS),
        last7d: since(7 * DAY_MS),
        last30d: since(30 * DAY_MS),
        allTime: count(),
      })
      .from(clicks)
      .where(eq(clicks.linkId, linkId)),
    db
      .select({ day: dayExpr, value: count() })
      .from(clicks)
      .where(eq(clicks.linkId, linkId))
      .groupBy(dayExpr)
      .orderBy(desc(count()))
      .limit(1),
    db
      .select({
        direct: sql<number>`count(*) filter (where ${clicks.referrer} is null)`.mapWith(
          Number,
        ),
        referrer: sql<number>`count(*) filter (where ${clicks.referrer} is not null)`.mapWith(
          Number,
        ),
      })
      .from(clicks)
      .where(base),
  ]);

  const w = windows[0];
  const b = best[0];
  const s = split[0];

  return {
    range,
    createdAt: createdAt.toISOString(),
    totalClicks: Number(totals[0]?.total ?? 0),
    uniqueVisitors: Number(totals[0]?.unique ?? 0),
    windows: {
      last24h: Number(w?.last24h ?? 0),
      last7d: Number(w?.last7d ?? 0),
      last30d: Number(w?.last30d ?? 0),
      allTime: Number(w?.allTime ?? 0),
    },
    bestDay: b ? { day: b.day, count: Number(b.value) } : null,
    directClicks: Number(s?.direct ?? 0),
    referrerClicks: Number(s?.referrer ?? 0),
    timeseries: series.map((r) => ({ day: r.day, count: Number(r.value) })),
    countries,
    referrers,
    devices,
    browsers,
    os: operatingSystems,
  };
}
