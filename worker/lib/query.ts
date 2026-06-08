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
