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
import { verifyPassword } from "./lib/password";
import { qrSvg } from "./lib/qrsvg";
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

// Public QR payload for the standalone `/qr/<slug>` page (anyone can open it,
// like lnk.ua/qr/…). Active links only, and it returns nothing the redirect
// doesn't already reveal: the short URL plus the project's brand colour/logo.
app.get("/api/qr/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!isValidCustomSlug(slug)) return c.json({ error: "Not found" }, 404);
  const { db, schema, close } = getDbHandle(c.env);
  const { links, projects } = schema;
  try {
    const rows = await db
      .select({
        slug: links.slug,
        isActive: links.isActive,
        expiresAt: links.expiresAt,
        color: projects.color,
        logo: projects.logo,
      })
      .from(links)
      .leftJoin(projects, eq(links.projectId, projects.id))
      .where(eq(links.slug, slug))
      .limit(1);
    const l = rows[0];
    const expired = l?.expiresAt ? l.expiresAt.getTime() <= Date.now() : false;
    if (!l || !l.isActive || expired) return c.json({ error: "Not found" }, 404);
    const logo =
      l.logo && (l.logo.startsWith("data:") || l.logo.startsWith("http")) ? l.logo : null;
    return c.json(
      { shortUrl: `${c.env.APP_URL}/${l.slug}`, color: l.color ?? null, logo },
      200,
      { "cache-control": "public, max-age=300" },
    );
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

// Public unlock for password-protected links: verify the password, then 302 to
// the (per-OS) destination, or re-render the prompt with an error. PBKDF2 makes
// brute force slow; the no-JS form posts here from the unlock page.
app.post("/api/unlock/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!isValidCustomSlug(slug)) return spa(c, 404);
  const body = await c.req.parseBody();
  const password = typeof body.password === "string" ? body.password : "";
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
        passwordHash: links.passwordHash,
      })
      .from(links)
      .where(eq(links.slug, slug))
      .limit(1);
    const l = rows[0];
    const expired = l?.expiresAt ? l.expiresAt.getTime() <= Date.now() : false;
    if (!l || !l.isActive || expired) return spa(c, 410);
    if (l.passwordHash && !(await verifyPassword(password, l.passwordHash))) {
      return passwordPage(c, slug, "Incorrect password. Try again.");
    }
    c.executionCtx.waitUntil(logClick(c, l.id));
    const { os, deviceType } = parseUserAgent(c.req.header("user-agent") ?? null);
    const target = routeDestination(
      {
        id: l.id,
        destination: l.destination,
        iosUrl: l.iosUrl,
        androidUrl: l.androidUrl,
        desktopUrl: l.desktopUrl,
        isActive: l.isActive,
        hasPassword: true,
        expiresAt: null,
      },
      os,
      deviceType,
    );
    return new Response(null, {
      status: 302,
      headers: { Location: target, "Cache-Control": "private, no-store" },
    });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

app.route("/api", api);

// --- Dynamic branding / SEO endpoints ---------------------------------------
app.get("/robots.txt", async (c) =>
  c.text(await robotsTxt(c.env), 200, { "cache-control": "public, max-age=3600" }),
);
app.get("/icon", (c) => serveBrandImage(c.env, "icon"));
app.get("/og", (c) => serveBrandImage(c.env, "og"));
// Public per-link OG image (so social crawlers can fetch a real URL).
app.get("/ogimg/:id", (c) => serveLinkOgImage(c, c.req.param("id")));

// Direct QR image: /qr/<slug>.svg returns a scannable, brand-coloured SVG that
// can be embedded or shared anywhere. The bare /qr/<slug> stays the HTML page.
app.get("/qr/:file", async (c) => {
  const file = c.req.param("file");
  const m = /^([a-zA-Z0-9_-]{3,32})\.svg$/.exec(file);
  if (!m) return serveAssets(c); // not a .svg request → serve the SPA page
  const slug = m[1];
  const { db, schema, close } = getDbHandle(c.env);
  const { links, projects } = schema;
  try {
    const rows = await db
      .select({
        slug: links.slug,
        isActive: links.isActive,
        expiresAt: links.expiresAt,
        color: projects.color,
      })
      .from(links)
      .leftJoin(projects, eq(links.projectId, projects.id))
      .where(eq(links.slug, slug))
      .limit(1);
    const l = rows[0];
    const expired = l?.expiresAt ? l.expiresAt.getTime() <= Date.now() : false;
    if (!l || !l.isActive || expired) return spa(c, 404);
    const dark = /^#[0-9a-fA-F]{6}$/.test(l.color ?? "") ? (l.color as string) : "#0b0b0c";
    return c.body(qrSvg(`${c.env.APP_URL}/${l.slug}`, { dark }), 200, {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    });
  } finally {
    c.executionCtx.waitUntil(close());
  }
});

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
          passwordHash: links.passwordHash,
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
          hasPassword: Boolean(l.passwordHash),
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

  // Password-gated links: show the unlock prompt instead of forwarding. The
  // click is counted on a successful unlock (in /api/unlock), not here.
  if (cached.hasPassword) return passwordPage(c, slug);

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

const htmlEsc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A clean, no-JS unlock page for password-protected links. The form POSTs to
 * /api/unlock/:slug; the server 302s on the right password or re-renders this
 * page with an error — so it works under our strict CSP (no inline scripts).
 */
async function passwordPage(c: AppContext, slug: string, error?: string): Promise<Response> {
  const cfg = await getCachedPublicConfig(c.env);
  const brand = /^#[0-9a-fA-F]{6}$/.test(cfg.brandColor) ? cfg.brandColor : "#e5392e";
  const app = htmlEsc(cfg.appName || "Shortlink");
  const logo = cfg.logoUrl
    ? `<img src="${htmlEsc(cfg.logoUrl)}" alt="" width="44" height="44" style="border-radius:10px;object-fit:cover">`
    : `<div style="width:44px;height:44px;border-radius:10px;background:${brand}"></div>`;
  const err = error
    ? `<p style="margin:2px 0 0;color:#dc2626;font-size:13px">${htmlEsc(error)}</p>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${app} — Protected link</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:"IBM Plex Sans Thai",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f4f4f5;color:#18181b}
.card{width:100%;max-width:380px;background:#fff;border:1px solid #e7e7ea;border-radius:18px;padding:32px;box-shadow:0 8px 30px rgba(0,0,0,.06);text-align:center}
.mark{display:flex;justify-content:center;margin-bottom:18px}
h1{margin:0 0 6px;font-size:19px;font-weight:600}
.sub{margin:0 0 22px;color:#71717a;font-size:14px}
form{display:flex;flex-direction:column;gap:12px;text-align:left}
input{height:44px;border:1px solid #d4d4d8;border-radius:10px;padding:0 14px;font-size:16px;outline:none}
input:focus{border-color:${brand};box-shadow:0 0 0 3px ${brand}22}
button{height:44px;border:0;border-radius:10px;background:${brand};color:#fff;font-size:15px;font-weight:600;cursor:pointer}
.foot{margin:22px 0 0;color:#a1a1aa;font-size:12px}
</style></head><body><div class="card"><div class="mark">${logo}</div><h1>Protected link</h1><p class="sub">Enter the password to continue.</p><form method="POST" action="/api/unlock/${slug}"><input type="password" name="password" placeholder="Password" autofocus required autocomplete="off">${err}<button type="submit">Unlock</button></form><p class="foot">${app}</p></div></body></html>`;
  return c.html(html, error ? 401 : 200, { "cache-control": "private, no-store" });
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
      // If the destination exposes no image, fall back to the branded card we
      // baked at create time (stored like a custom image, served from R2) so the
      // shared card still looks designed instead of bare.
      if (!preview.image && l.ogImage) {
        preview.image = l.ogImage.startsWith("http")
          ? l.ogImage
          : `${c.env.APP_URL}/ogimg/${l.id}`;
      }
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
    // For a locked link, point the HTML fallback at the short URL (the unlock
    // page), never the destination — so the protected URL can't leak via source.
    return c.html(
      previewHtml(preview, l.passwordHash ? c.req.url : l.destination, bundle.appName, c.req.url),
    );
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
