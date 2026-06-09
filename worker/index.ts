import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { eq, sql } from "drizzle-orm";
import type { AppContext, AppEnv } from "./env";
import { getDbHandle } from "./db";
import { dbMiddleware } from "./middleware/db";
import { loadSession } from "./middleware/auth";
import { requireSameOrigin, securityHeaders } from "./middleware/security";
import authRoutes from "./routes/auth";
import linkRoutes from "./routes/links";
import adminRoutes from "./routes/admin";
import setupRoutes from "./routes/setup";
import qrPresetRoutes from "./routes/qr-presets";
import assetRoutes from "./routes/assets";
import domainRoutes from "./routes/domains";
import { getCachedPublicConfig } from "./lib/appconfig";
import { getCachedLink, putCachedLink } from "./lib/cache";
import {
  getSeoBundle,
  injectSeo,
  robotsTxt,
  serveBrandImage,
} from "./lib/seo";
import { isValidCustomSlug } from "./lib/slug";
import {
  getClientIp,
  getCountry,
  getReferrer,
  parseUserAgent,
} from "./lib/geo";

const app = new Hono<AppEnv>();

// Security headers on every response (incl. the SPA and redirects).
app.use("*", securityHeaders);

// --- JSON API ---------------------------------------------------------------
const api = new Hono<AppEnv>();
api.use("*", dbMiddleware);
api.use("*", csrf());
api.use("*", requireSameOrigin);
api.use("*", loadSession);
api.route("/auth", authRoutes);
api.route("/links", linkRoutes);
api.route("/admin", adminRoutes);
api.route("/setup", setupRoutes);
api.route("/qr-presets", qrPresetRoutes);
api.route("/assets", assetRoutes);
api.route("/domains", domainRoutes);

// Public, cacheable endpoints — registered before the API group so they skip the
// per-request DB client + auth/CSRF middleware entirely. /config is served from
// KV (no DB round-trip on a hit), which is the hottest endpoint under traffic.
app.get("/api/config", async (c) => c.json(await getCachedPublicConfig(c.env)));
app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api", api);

// --- Dynamic branding / SEO endpoints ---------------------------------------
app.get("/robots.txt", async (c) =>
  c.text(await robotsTxt(c.env), 200, { "cache-control": "public, max-age=3600" }),
);
app.get("/icon", (c) => serveBrandImage(c.env, "icon"));
app.get("/og", (c) => serveBrandImage(c.env, "og"));

// --- Redirect hot path ------------------------------------------------------
app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  // Only well-formed, non-reserved slugs get a DB lookup. Everything else —
  // app routes, /favicon.ico, and dev module paths like /@react-refresh — is an asset.
  if (!isValidCustomSlug(slug)) return serveAssets(c);

  const kv = c.env.LINKS_KV;
  let cached = await getCachedLink(kv, slug);

  // KV miss → the database is the source of truth; warm the cache for next time.
  if (!cached) {
    const { db, schema, close } = getDbHandle(c.env);
    const { links } = schema;
    try {
      const rows = await db
        .select({
          id: links.id,
          destination: links.destination,
          isActive: links.isActive,
          expiresAt: links.expiresAt,
        })
        .from(links)
        .where(eq(links.slug, slug))
        .limit(1);
      const l = rows[0];
      if (l) {
        cached = {
          id: l.id,
          destination: l.destination,
          isActive: l.isActive,
          expiresAt: l.expiresAt ? l.expiresAt.getTime() : null,
        };
        c.executionCtx.waitUntil(putCachedLink(kv, slug, cached));
      }
    } finally {
      c.executionCtx.waitUntil(close());
    }
  }

  if (!cached) return spa(c, 404);
  if (!cached.isActive || (cached.expiresAt !== null && cached.expiresAt <= Date.now())) {
    return spa(c, 410);
  }

  // Log the click off the response path so the redirect stays instant.
  c.executionCtx.waitUntil(logClick(c, cached.id));
  return c.redirect(cached.destination, 302);
});

// --- SPA fallback for everything else ---------------------------------------
app.all("*", (c) => serveAssets(c));

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

/**
 * Copy the assets response into a fresh Response so downstream middleware
 * (security headers) can mutate headers — a fetched Response has immutable headers.
 */
async function serveAssets(c: AppContext): Promise<Response> {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const out = new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
  // Inject branding + SEO meta into the SPA shell for crawlers & social unfurls.
  if (out.headers.get("content-type")?.includes("text/html")) {
    return injectSeo(out, await getSeoBundle(c.env));
  }
  return out;
}

/** Serve the SPA shell with an explicit status (404/410 for SEO correctness). */
async function spa(c: AppContext, status: number): Promise<Response> {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(res.body, { status, headers: res.headers });
}

async function logClick(c: AppContext, linkId: string): Promise<void> {
  const { db, schema, close } = getDbHandle(c.env);
  const { clicks, links } = schema;
  try {
    const { browser, os, deviceType } = parseUserAgent(
      c.req.header("user-agent") ?? null,
    );
    await Promise.all([
      db.insert(clicks).values({
        linkId,
        country: getCountry(c),
        referrer: getReferrer(c),
        browser,
        os,
        deviceType,
        // Stored to count unique visitors; disclosed in the privacy policy.
        ipHash: getClientIp(c),
      }),
      db
        .update(links)
        .set({ clickCount: sql`${links.clickCount} + 1` })
        .where(eq(links.id, linkId)),
    ]);
  } catch (err) {
    console.error("logClick failed:", err);
  } finally {
    await close();
  }
}

export default app;
