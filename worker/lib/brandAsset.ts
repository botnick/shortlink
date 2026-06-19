import type { AppBindings } from "../env";
import type { DB, DbSchema } from "../db";
import { setSetting, SETTING_KEYS } from "./settings";

// Brand images (the header logo + OG image) used to be stored as base64 `data:`
// URIs directly in the settings table — so a ~100KB logo shipped inside every
// /api/config the SPA fetches on load. We move rasters into R2 under a
// content-addressed key and store only the served path, dropping the config from
// ~105KB to ~2KB. SVGs/other are left inline (small; not the bloat).

const RASTER: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_BYTES = 1_500_000; // decoded cap — brand art well under this

async function sha256hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** If `value` is a raster `data:` image (png/jpeg/webp/gif), upload it to R2 under
 *  a content-addressed key and return its public path `/brand/<kind>/<sha>`.
 *  Anything else (an existing URL, an SVG/other `data:` URI, or "") is returned
 *  unchanged — nothing is lost; only the large inline rasters move out. */
export async function normalizeBrandImage(
  env: AppBindings,
  kind: "logo" | "og",
  value: unknown,
): Promise<string> {
  if (typeof value !== "string") return "";
  if (!value.startsWith("data:")) return value; // URL or "" — leave as-is
  const m = /^data:([^;]+);base64,(.+)$/.exec(value);
  if (!m) return value;
  const ext = RASTER[m[1].toLowerCase()];
  if (!ext) return value; // svg / unknown type → keep inline (not the bloat)
  let bytes: Uint8Array;
  try {
    const bin = atob(m[2]);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return value;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return value;
  const key = `brand/${kind}/${await sha256hex(bytes)}`;
  await env.LOGO_BUCKET.put(key, bytes, { httpMetadata: { contentType: m[1] } });
  return `/${key}`;
}

/** One-time, idempotent migration: move any inline `data:` logo / OG image into
 *  R2 and rewrite the setting to its served URL. Pass the already-read settings
 *  `map` (it is mutated in place) so callers don't read the table twice. */
export async function migrateBrandImages(
  env: AppBindings,
  db: DB,
  schema: DbSchema,
  map: Record<string, unknown>,
): Promise<void> {
  for (const [key, kind] of [
    [SETTING_KEYS.logo, "logo"],
    [SETTING_KEYS.ogImage, "og"],
  ] as const) {
    const v = map[key];
    if (typeof v === "string" && v.startsWith("data:")) {
      const url = await normalizeBrandImage(env, kind, v);
      if (url !== v) {
        await setSetting(db, schema, key, url);
        map[key] = url;
      }
    }
  }
}
