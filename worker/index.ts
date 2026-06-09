import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { and, eq, lt, sql } from "drizzle-orm";
import type { AppContext, AppEnv, AppBindings } from "./env";
import { getDbHandle } from "./db";
import {
  domainUnverifiedDaysFrom,
  getAllSettings,
  saasConfigFrom,
} from "./lib/settings";
import { deleteCustomHostname } from "./lib/cloudflare";
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
import projectRoutes from "./routes/projects";
import { getCachedPublicConfig } from "./lib/appconfig";
import { getCachedLink, putCachedLink, routeDestination } from "./lib/cache";
import {
  getSeoBundle,
  injectSeo,
  robotsTxt,
  serveBrandImage,
} from "./lib/seo";
import { isValidCustomSlug } from "./lib/slug";
import { destinationPreview, isCrawler, previewHtml } from "./lib/social";
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
api.route("/projects", projectRoutes);

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
// Public per-link OG image (so social crawlers can fetch a real URL).
app.get("/ogimg/:id", (c) => serveLinkOgImage(c, c.req.param("id")));

// --- Redirect hot path ------------------------------------------------------
app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  // Only well-formed, non-reserved slugs get a DB lookup. Everything else —
  // app routes, /favicon.ico, and dev module paths like /@react-refresh — is an asset.
  if (!isValidCustomSlug(slug)) return serveAssets(c);

  // Social crawlers (FB/X/IG/Slack/…) get an OG-tagged preview instead of the
  // redirect, so a shared link can show a branded card. Bots don't run JS and
  // aren't counted as clicks; humans always fall through to the fast path.
  if (isCrawler(c.req.header("user-agent") ?? null)) {
    const preview = await serveSocialPreview(c, slug);
    if (preview) return preview;
  }

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
          iosUrl: links.iosUrl,
          androidUrl: links.androidUrl,
          desktopUrl: links.desktopUrl,
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
          iosUrl: l.iosUrl,
          androidUrl: l.androidUrl,
          desktopUrl: l.desktopUrl,
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
  // Per-OS deep-link routing (iOS / Android / desktop), resolved on the cached
  // payload so it stays on the edge with no extra DB read.
  const { os, deviceType } = parseUserAgent(c.req.header("user-agent") ?? null);
  const target = routeDestination(cached, os, deviceType);
  // 302 (not 301) + no-store: never let a browser/proxy cache the hop. This is
  // the deliberate opposite of the big shorteners' cacheable 301 — it guarantees
  // every click reaches us (so analytics are complete) and a destination edit
  // takes effect on the very next click instead of being frozen by a cache.
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      "Cache-Control": "private, no-store",
    },
  });
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

/**
 * For social crawlers: return an OG-card HTML when the link opts into a preview,
 * else null (so the caller continues to the normal redirect path). Does a DB
 * lookup — fine because crawler hits are infrequent (once per share).
 */
async function serveSocialPreview(
  c: AppContext,
  slug: string,
): Promise<Response | null> {
  const { db, schema, close } = getDbHandle(c.env);
  const { links } = schema;
  try {
    const rows = await db.select().from(links).where(eq(links.slug, slug)).limit(1);
    const l = rows[0];
    if (!l) return null;
    const expired = l.expiresAt ? l.expiresAt.getTime() <= Date.now() : false;
    if (!l.isActive || expired || l.previewMode === "off") return null;

    let preview;
    if (l.previewMode === "destination") {
      preview = await destinationPreview(c.env, l.id, l.destination);
    } else {
      // og:image must be a public URL (social ignores data: URLs). A custom
      // image lives in R2 ("r2") and is served via the public /ogimg/:id endpoint.
      const image = l.ogImage
        ? l.ogImage.startsWith("http")
          ? l.ogImage
          : `${c.env.APP_URL}/ogimg/${l.id}`
        : "";
      preview = {
        title: l.ogTitle ?? l.title ?? "",
        description: l.ogDescription ?? "",
        image,
      };
    }
    if (!preview.title) preview.title = l.title ?? l.slug;
    const bundle = await getSeoBundle(c.env);
    // og:url = this short link (the page being shared) so the card is credited to
    // us; the destination is only used for the redirect fallback inside the HTML.
    return c.html(previewHtml(preview, l.destination, bundle.appName, c.req.url));
  } finally {
    c.executionCtx.waitUntil(close());
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Serve a link's custom OG image bytes publicly from R2 (keyed by link id). */
async function serveLinkOgImage(c: AppContext, id: string): Promise<Response> {
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });
  const { db, schema, close } = getDbHandle(c.env);
  const { links } = schema;
  try {
    const rows = await db
      .select({ ogImage: links.ogImage })
      .from(links)
      .where(eq(links.id, id))
      .limit(1);
    const src = rows[0]?.ogImage ?? "";
    if (src.startsWith("http")) return Response.redirect(src, 302);
    // Custom OG images are stored as a blob in R2 (keyed by link id), not in the DB.
    if (src !== "r2") return new Response("Not found", { status: 404 });
    const obj = await c.env.LOGO_BUCKET.get(`og/${id}`);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, {
      headers: {
        "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
        "cache-control": "public, max-age=86400",
      },
    });
  } finally {
    c.executionCtx.waitUntil(close());
  }
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

/** Cron: remove custom domains left unverified past the configured window
 *  (admin setting `domainUnverifiedDays`, default 90; 0 disables). Releases the
 *  Cloudflare-for-SaaS hostname too. Users are warned in-app via a countdown. */
async function cleanupUnverifiedDomains(env: AppBindings): Promise<void> {
  const { db, schema, close } = getDbHandle(env);
  try {
    const settings = await getAllSettings(db, schema);
    const days = domainUnverifiedDaysFrom(settings);
    if (days <= 0) return;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const { domains } = schema;
    const stale = await db
      .select({ id: domains.id, cfHostnameId: domains.cfHostnameId })
      .from(domains)
      .where(and(eq(domains.status, "pending"), lt(domains.createdAt, cutoff)));
    if (stale.length === 0) return;
    const saas = saasConfigFrom(settings, env.APP_URL);
    if (saas) {
      for (const d of stale) {
        if (d.cfHostnameId) {
          await deleteCustomHostname(saas, d.cfHostnameId).catch(() => {});
        }
      }
    }
    await db
      .delete(domains)
      .where(and(eq(domains.status, "pending"), lt(domains.createdAt, cutoff)));
  } finally {
    await close();
  }
}

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledController,
    env: AppBindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(cleanupUnverifiedDomains(env));
  },
};
