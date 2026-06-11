import { type SQL, or, sql } from "drizzle-orm";
import type { Dialect } from "../db";

/**
 * Portable, case-insensitive "contains" search across one or more text columns.
 * Returns undefined for an empty term (so callers can spread it into `and(...)`).
 * `%`/`_` in the term are escaped so they match literally.
 */
export function searchCondition(cols: SQL[], term: string): SQL | undefined {
  const t = term.trim().toLowerCase();
  if (!t) return undefined;
  const q = `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  return or(...cols.map((c) => sql`lower(${c}) like ${q} escape '\\'`));
}

/** Group/format a timestamp column to a YYYY-MM-DD day bucket, per dialect. */
export function dayBucket(dialect: Dialect, col: SQL): SQL<string> {
  return dialect === "sqlite"
    ? sql<string>`strftime('%Y-%m-%d', ${col}, 'unixepoch')`
    : sql<string>`to_char(date_trunc('day', ${col}), 'YYYY-MM-DD')`;
}

type Granularity = "hour" | "day";

/**
 * Pick the time-series bucket for a range: hourly for the 24h view (so the chart
 * has 24 points instead of one), daily otherwise. Both dialects emit the SAME
 * label format ("YYYY-MM-DDTHH:00" or "YYYY-MM-DD") so the client formats them
 * uniformly. Returns the SQL expression plus the chosen granularity.
 */
export function timeBucket(
  dialect: Dialect,
  col: SQL,
  range: string,
): { expr: SQL<string>; granularity: Granularity } {
  if (range === "24h") {
    return {
      expr:
        dialect === "sqlite"
          ? sql<string>`strftime('%Y-%m-%dT%H:00', ${col}, 'unixepoch')`
          : sql<string>`to_char(date_trunc('hour', ${col}), 'YYYY-MM-DD"T"HH24:00')`,
      granularity: "hour",
    };
  }
  return { expr: dayBucket(dialect, col), granularity: "day" };
}
