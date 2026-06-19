import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { type SQL, and, count, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import type { AppContext, AppEnv, AppBindings } from "../env";
import type { DB, DbSchema } from "../db";
import type { LinkRow } from "../db/schema";
import {
  assistLinkSchema,
  bulkImportSchema,
  createLinkSchema,
  slugCheckSchema,
  updateLinkSchema,
} from "../lib/validators";
import { generateSlug, isValidCustomSlug } from "../lib/slug";
import { deleteCachedLink, putCachedLink } from "../lib/cache";
import { buildShortUrl, domainBucket } from "../lib/domainScope";
import { shortOrigin } from "../lib/appconfig";
import { cachePayload, purgeLinkCache, refreshLinkCache } from "../lib/linkCache";
import { hashPassword, pbkdf2Iterations } from "../lib/password";
import { searchCondition } from "../lib/query";
import { fetchMeta, invalidateLinkPreview } from "../lib/social";
import { resolveProjectId } from "../lib/projects";

/**
 * Store a link's OG image in R2 (cheap blob storage) instead of bloating the DB
 * row with a base64 data URL. Returns the value to persist in `links.ogImage`:
 * "r2" (stored at og/<id>), the http URL as-is, or "" (none / removed).
 */
async function resolveOgImage(
  env: AppBindings,
  linkId: string,
  value: string | null | undefined,
): Promise<string> {
  const key = `og/${linkId}`;
  if (!value) {
    await env.LOGO_BUCKET.delete(key).catch(() => {});
    return "";
  }
  // Our own pointer URL (edit without changing the image) → keep the R2 object.
  // Origin-agnostic: the DTO ships a relative `/ogimg/<id>`, but older rows may
  // hold an absolute pointer — match either so an unchanged edit never drops it.
  if (value.endsWith(`/ogimg/${linkId}`)) return "r2";
  // Switched to an external image URL → drop any R2 blob we were holding so it
  // doesn't linger orphaned (delete on a missing key is a harmless no-op).
  if (value.startsWith("http")) {
    await env.LOGO_BUCKET.delete(key).catch(() => {});
    return value;
  }
  const m = /^data:([^;]+);base64,(.+)$/.exec(value);
  if (!m) return "";
  // Only store raster image types. SVG (image/svg+xml) is rejected on purpose:
  // /ogimg/:id serves these bytes same-origin with their stored content-type, so
  // an SVG would render inline and could carry script — restrict the MIME here
  // (and the endpoint sends X-Content-Type-Options: nosniff as a second layer).
  const mime = m[1].toLowerCase();
  if (!["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"].includes(mime)) {
    await env.LOGO_BUCKET.delete(key).catch(() => {});
    return "";
  }
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await env.LOGO_BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } });
    return "r2";
  } catch {
    return ""; // malformed image → store nothing rather than failing the request
  }
}
import {
  aiAssistantEnabledFrom,
  blockedDomainsFrom,
  createRateLimitFrom,
  exportMaxRowsFrom,
  extraReservedFrom,
  getAllSettings,
  isBlockedDestination,
  maxAliasesPerLinkFrom,
  maxLinksPerUserFrom,
  slugLengthFrom,
} from "../lib/settings";
import { toCsv } from "../lib/csv";
import { counterBump, counterGet, isRateLimited } from "../lib/ratelimit";
import { aiSuggest } from "../lib/aiAssistant";
import { requireAuth } from "../middleware/auth";
import { computeStats, parseRange, rangeStart } from "./stats";
import type { LinkDTO, LinkListDTO } from "@shared/types";

const route = new Hono<AppEnv>();
route.use("*", requireAuth);

const PAGE_SIZE = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toLinkDTO(
  base: string,
  row: LinkRow,
  domainHost: string | null,
): LinkDTO {
  return {
    id: row.id,
    slug: row.slug,
    shortUrl: buildShortUrl(base, domainHost, row.slug),
    destination: row.destination,
    iosUrl: row.iosUrl,
    androidUrl: row.androidUrl,
    desktopUrl: row.desktopUrl,
    geoRules: row.geoRules ?? [],
    isActive: row.isActive,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    clickCount: row.clickCount,
    previewMode: (row.previewMode as LinkDTO["previewMode"]) ?? "off",
    ogTitle: row.ogTitle,
    ogDescription: row.ogDescription,
    // Relative so the editor <img> loads from the current origin (dev → the dev
    // Worker/R2; prod → the live host) instead of a placeholder APP_URL.
    ogImage:
      row.ogImage === "r2" ? `/ogimg/${row.id}` : row.ogImage || null,
    projectId: row.projectId,
    domainId: row.domainId,
    domain: domainHost,
    hasPassword: Boolean(row.passwordHash),
    qrConfig: (row.qrConfig as Record<string, unknown> | null) ?? null,
    tags: (row.tags as string[] | null) ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}

/** id→hostname for the user's domains (a small set, ≤ the per-user cap). */
async function userDomainHosts(
  db: DB,
  schema: DbSchema,
  userId: string,
): Promise<Map<string, string>> {
  const { domains } = schema;
  const rows = await db
    .select({ id: domains.id, hostname: domains.hostname })
    .from(domains)
    .where(eq(domains.userId, userId));
  return new Map(rows.map((r) => [r.id, r.hostname] as const));
}

/** The hostname for one domain id, or null for the default short host. */
async function hostFor(
  db: DB,
  schema: DbSchema,
  domainId: string | null,
): Promise<string | null> {
  if (!domainId) return null;
  const { domains } = schema;
  const r = await db
    .select({ hostname: domains.hostname })
    .from(domains)
    .where(eq(domains.id, domainId))
    .limit(1);
  return r[0]?.hostname ?? null;
}

/** Validate a chosen domain is the user's and usable (verified/active), or null
 *  for the default host. Returns the hostname, or a client error message. */
async function resolveLinkDomain(
  db: DB,
  schema: DbSchema,
  userId: string,
  domainId: string | null | undefined,
): Promise<{ hostname: string | null } | { error: string }> {
  if (!domainId) return { hostname: null };
  const { domains } = schema;
  const r = await db
    .select({ hostname: domains.hostname, status: domains.status, userId: domains.userId })
    .from(domains)
    .where(eq(domains.id, domainId))
    .limit(1);
  const d = r[0];
  if (!d || d.userId !== userId) return { error: "That domain isn’t available" };
  // Allowlist the two "ready" states (active = Cloudflare-for-SaaS, verified =
  // DNS) instead of only rejecting the literal "pending". Every other Cloudflare
  // status (pending_validation, pending_deployment, blocked, moved, …) means the
  // host isn't actually routing yet, so a link created on it would dead-end. This
  // matches the cleanup cron, which treats only active/verified as done.
  if (d.status !== "verified" && d.status !== "active") {
    return { error: "Verify that domain before using it" };
  }
  return { hostname: d.hostname };
}

/** Is (domain, slug) already a live back-half or a retired alias of another link? */
async function slugTaken(
  db: DB,
  schema: DbSchema,
  domainId: string | null,
  slug: string,
  exceptLinkId?: string,
): Promise<boolean> {
  const { links, linkAliases } = schema;
  const live = await db
    .select({ id: links.id })
    .from(links)
    .where(
      and(
        eq(links.slug, slug),
        domainBucket(links.domainId, domainId),
        exceptLinkId ? ne(links.id, exceptLinkId) : undefined,
      ),
    )
    .limit(1);
  if (live[0]) return true;
  const alias = await db
    .select({ id: linkAliases.id })
    .from(linkAliases)
    .where(
      and(
        eq(linkAliases.slug, slug),
        domainBucket(linkAliases.domainId, domainId),
        exceptLinkId ? ne(linkAliases.linkId, exceptLinkId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(alias[0]);
}

function isUniqueViolation(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  // Drizzle wraps the driver error, so the Postgres code can be nested in `cause`.
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code === "23505" || err.cause?.code === "23505";
}

async function getOwnedLink(c: AppContext): Promise<LinkRow | null> {
  const id = c.req.param("id");
  if (!id || !UUID_RE.test(id)) return null;
  const { links } = c.var.schema;
  const rows = await c.var.db
    .select()
    .from(links)
    .where(and(eq(links.id, id), eq(links.userId, c.var.user!.id)))
    .limit(1);
  return rows[0] ?? null;
}

// LIST — keyset pagination, newest first.
route.get("/", async (c) => {
  const user = c.var.user!;
  const { links } = c.var.schema;
  const cursor = c.req.query("cursor");
  const q = c.req.query("q") ?? "";

  // Search also matches inside the tags array (cast to text on Postgres).
  const tagsText =
    c.var.dialect === "sqlite" ? sql`${links.tags}` : sql`${links.tags}::text`;
  const search = searchCondition(
    [sql`${links.slug}`, sql`${links.destination}`, tagsText],
    q,
  );
  const cursorCond =
    cursor && !Number.isNaN(Date.parse(cursor))
      ? lt(links.createdAt, new Date(cursor))
      : undefined;
  const projectId = c.req.query("projectId");
  const projectCond =
    projectId && UUID_RE.test(projectId) ? eq(links.projectId, projectId) : undefined;
  const tag = c.req.query("tag")?.trim();
  const tagCond = tag
    ? c.var.dialect === "sqlite"
      ? sql`exists (select 1 from json_each(${links.tags}) where value = ${tag})`
      : sql`${links.tags} @> ${JSON.stringify([tag])}::jsonb`
    : undefined;
  // Exact back-half lookup (used by the MCP resolver): ?slug= matches exactly;
  // ?host= narrows to one domain bucket — "default" for the default host.
  const exactSlug = c.req.query("slug")?.trim();
  const slugCond = exactSlug ? eq(links.slug, exactSlug) : undefined;
  let hostCond: SQL | undefined;
  const hostQ = c.req.query("host")?.trim().toLowerCase();
  if (hostQ === "default") {
    hostCond = sql`${links.domainId} is null`;
  } else if (hostQ) {
    const { domains } = c.var.schema;
    const d = await c.var.db
      .select({ id: domains.id })
      .from(domains)
      .where(eq(domains.hostname, hostQ))
      .limit(1);
    if (!d[0]) return c.json({ links: [], nextCursor: null } satisfies LinkListDTO);
    hostCond = eq(links.domainId, d[0].id);
  }
  const where = and(
    eq(links.userId, user.id),
    ...([search, cursorCond, projectCond, tagCond, slugCond, hostCond].filter(
      Boolean,
    ) as SQL[]),
  );

  const rows = await c.var.db
    .select()
    .from(links)
    .where(where)
    .orderBy(desc(links.createdAt))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const [hosts, base] = await Promise.all([
    userDomainHosts(c.var.db, c.var.schema, user.id),
    shortOrigin(c.env),
  ]);
  const body: LinkListDTO = {
    links: page.map((r) =>
      toLinkDTO(base, r, r.domainId ? hosts.get(r.domainId) ?? null : null),
    ),
    nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
  };
  return c.json(body);
});

// CREATE
route.post("/", zValidator("json", createLinkSchema), async (c) => {
  const db = c.var.db;
  const schema = c.var.schema;
  const { links } = schema;
  const user = c.var.user!;
  const input = c.req.valid("json");
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

  // Admin-configured guardrails: blocked destination domains, reserved aliases,
  // and a per-user link quota.
  const settings = await getAllSettings(db, schema);
  if (isBlockedDestination(input.destination, blockedDomainsFrom(settings))) {
    return c.json({ error: "That destination domain isn’t allowed" }, 400);
  }
  if (
    input.geoRules?.some((r) =>
      isBlockedDestination(r.url, blockedDomainsFrom(settings)),
    )
  ) {
    return c.json({ error: "A country-routing destination domain isn’t allowed" }, 400);
  }
  if (input.slug && extraReservedFrom(settings).includes(input.slug.toLowerCase())) {
    return c.json({ error: "That custom alias is reserved" }, 400);
  }
  const maxLinks = maxLinksPerUserFrom(settings);
  if (maxLinks > 0) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(links)
      .where(eq(links.userId, user.id));
    if (Number(n) >= maxLinks) {
      return c.json({ error: `You’ve reached your link limit (${maxLinks})` }, 409);
    }
  }
  // Throttle bursts of link creation per user (spam protection).
  if (await isRateLimited(c.env, `create:${user.id}`, createRateLimitFrom(settings), 3600)) {
    return c.json({ error: "You’re creating links too quickly — please slow down" }, 429);
  }

  // Resolve which domain the back-half lives on (the default host, or one of the
  // user's verified custom domains).
  const dom = await resolveLinkDomain(db, schema, user.id, input.domainId);
  if ("error" in dom) return c.json({ error: dom.error }, 400);
  const domainId = input.domainId ?? null;
  const domainHost = dom.hostname;

  // Place the link in the requested project (if owned) or the user's default.
  const projectId = await resolveProjectId(db, schema, user.id, user.email, input.projectId);
  const passwordHash = input.password ? await hashPassword(input.password, c.env.SESSION_SECRET, pbkdf2Iterations(c.env)) : null;

  const insertOne = async (slug: string) => {
    const row = (
      await db
        .insert(links)
        .values({
          slug,
          destination: input.destination,
          iosUrl: input.iosUrl ?? null,
          androidUrl: input.androidUrl ?? null,
          desktopUrl: input.desktopUrl ?? null,
          geoRules: input.geoRules ?? null,
          passwordHash,
          userId: user.id,
          projectId,
          domainId,
          tags: input.tags ?? null,
          expiresAt,
          previewMode: input.previewMode ?? "off",
          ogTitle: input.ogTitle ?? null,
          ogDescription: input.ogDescription ?? null,
          ogImage: "",
        })
        .returning()
    )[0];
    // OG image lives in R2 (keyed by the new id), not as a base64 blob in the DB.
    const og = await resolveOgImage(c.env, row.id, input.ogImage);
    if (og) {
      row.ogImage = og;
      await db.update(links).set({ ogImage: og }).where(eq(links.id, row.id));
    }
    await putCachedLink(c.env.LINKS_KV, row.domainId, row.slug, cachePayload(row));
    return row;
  };

  const base = await shortOrigin(c.env);
  if (input.slug) {
    if (!isValidCustomSlug(input.slug)) {
      return c.json({ error: "That custom alias isn't allowed" }, 400);
    }
    // Per-domain uniqueness spans both live back-halves and retired aliases.
    if (await slugTaken(db, schema, domainId, input.slug)) {
      return c.json({ error: "That custom alias is already taken" }, 409);
    }
    try {
      const row = await insertOne(input.slug);
      return c.json({ link: toLinkDTO(base, row, domainHost) }, 201);
    } catch (e) {
      if (isUniqueViolation(e)) {
        return c.json({ error: "That custom alias is already taken" }, 409);
      }
      throw e;
    }
  }

  const slugLen = slugLengthFrom(settings);
  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = generateSlug(slugLen);
    if (await slugTaken(db, schema, domainId, slug)) continue;
    try {
      const row = await insertOne(slug);
      return c.json({ link: toLinkDTO(base, row, domainHost) }, 201);
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
  }
  return c.json({ error: "Could not generate a unique slug, please retry" }, 500);
});

// BULK IMPORT — create many links at once. Each row is independent: invalid rows
// are reported back, valid ones are created. Registered before "/:id".
route.post("/import", zValidator("json", bulkImportSchema), async (c) => {
  const db = c.var.db;
  const schema = c.var.schema;
  const { links } = schema;
  const user = c.var.user!;
  const { rows, projectId: inputProjectId } = c.req.valid("json");

  const settings = await getAllSettings(db, schema);
  const blocked = blockedDomainsFrom(settings);
  const reserved = extraReservedFrom(settings);
  const maxLinks = maxLinksPerUserFrom(settings);
  const slugLen = slugLengthFrom(settings);
  // The whole batch goes into the dashboard's selected project (validated +
  // defaulted by resolveProjectId), not always the user's default.
  const projectId = await resolveProjectId(db, schema, user.id, user.email, inputProjectId);
  let total = Number(
    (await db.select({ n: count() }).from(links).where(eq(links.userId, user.id)))[0].n,
  );

  const base = await shortOrigin(c.env);
  const created: LinkDTO[] = [];
  const errors: { index: number; destination: string; reason: string }[] = [];
  const fail = (index: number, destination: string, reason: string) =>
    errors.push({ index, destination, reason });

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      if (maxLinks > 0 && total >= maxLinks) {
        fail(i, r.destination, `Link limit (${maxLinks}) reached`);
        continue;
      }
      if (isBlockedDestination(r.destination, blocked)) {
        fail(i, r.destination, "Destination domain isn’t allowed");
        continue;
      }
      const dom = await resolveLinkDomain(db, schema, user.id, r.domainId);
      if ("error" in dom) {
        fail(i, r.destination, dom.error);
        continue;
      }
      const domainId = r.domainId ?? null;

      let slug = r.slug;
      if (slug) {
        if (!isValidCustomSlug(slug) || reserved.includes(slug.toLowerCase())) {
          fail(i, r.destination, "That alias isn’t allowed");
          continue;
        }
        if (await slugTaken(db, schema, domainId, slug)) {
          fail(i, r.destination, "That alias is already taken");
          continue;
        }
      } else {
        slug = generateSlug(slugLen);
        for (let t = 0; t < 6 && (await slugTaken(db, schema, domainId, slug)); t++) {
          slug = generateSlug(slugLen);
        }
      }

      const row = (
        await db
          .insert(links)
          .values({
            slug,
            destination: r.destination,
            userId: user.id,
            projectId,
            domainId,
            tags: r.tags ?? null,
          })
          .returning()
      )[0];
      // Don't warm the KV cache here: a 500-row import would burn up to 500 of
      // the 1k/day KV write budget in one request. The redirect hot path lazy-
      // fills on first click (waitUntil), so imported-but-never-clicked links
      // cost zero writes and clicked ones pay exactly one, spread over real use.
      created.push(toLinkDTO(base, row, dom.hostname));
      total++;
    } catch (e) {
      fail(i, r.destination, isUniqueViolation(e) ? "That alias is already taken" : "Failed to create");
    }
  }

  return c.json({ created, errors });
});

// META — the destination's own title/description/image/favicon, for the rich
// link-preview card shown in the form (and served as-is to crawlers in
// "destination" mode). Registered before "/:id" so it isn't read as an id.
route.get("/meta", async (c) => {
  const url = c.req.query("url") ?? "";
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
  } catch {
    return c.json({ error: "Enter a valid URL first" }, 400);
  }
  return c.json({ meta: await fetchMeta(c.env, url) });
});

// AI link assistant — suggest slugs + social-card title/description from the
// destination page. Opt-in and hard-capped to stay on the free tier; every
// guard (disabled / rate-limited / daily cap / no AI binding / model error)
// returns source:"fallback" so the client runs the offline optimizer instead.
const AI_USER_LIMIT = 10; // model calls per hour per user
const AI_DAILY_CAP = 100; // global model calls per day (free-tier guard)
route.post("/assist", zValidator("json", assistLinkSchema), async (c) => {
  const user = c.var.user!;
  const { destination } = c.req.valid("json");
  const fallback = (reason: string) =>
    c.json({ slugs: [], ogTitle: null, ogDescription: null, source: "fallback", reason });

  const settings = await getAllSettings(c.var.db, c.var.schema);
  if (!aiAssistantEnabledFrom(settings)) return fallback("disabled");

  // A cache hit (same URL within 7 days) skips the caps entirely.
  let cacheKey = "";
  try {
    const u = new URL(destination);
    cacheKey = `aicache:v1:${u.host}${u.pathname}`.slice(0, 480);
    const cached = await c.env.LINKS_KV.get(cacheKey, "json");
    if (cached) return c.json({ ...(cached as object), source: "ai" });
  } catch {
    /* fall through */
  }

  if (await isRateLimited(c.env, `ai:user:${user.id}`, AI_USER_LIMIT, 3600)) {
    return fallback("rate_limited");
  }
  const day = new Date().toISOString().slice(0, 10);
  if ((await counterGet(c.env, `aiassist:${day}`)) >= AI_DAILY_CAP) {
    return fallback("daily_cap");
  }

  const suggestion = await aiSuggest(c.env, destination);
  if (!suggestion) return fallback("unavailable");

  await counterBump(c.env, `aiassist:${day}`, 48 * 3600);
  if (cacheKey) {
    await c.env.LINKS_KV.put(cacheKey, JSON.stringify(suggestion), {
      expirationTtl: 7 * 86_400,
    }).catch(() => {});
  }
  return c.json({ ...suggestion, source: "ai" });
});

// READ one
// Live availability check for the custom back-half (so the editor can tell the
// user before they submit). Registered before "/:id" so it isn't read as an id.
route.get("/slug-check", zValidator("query", slugCheckSchema), async (c) => {
  const { slug: rawSlug, domainId: rawDomain } = c.req.valid("query");
  const slug = rawSlug.trim();
  const domainId = rawDomain ?? null;
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(slug)) {
    return c.json({ available: false, reason: "format" });
  }
  if (!isValidCustomSlug(slug)) {
    return c.json({ available: false, reason: "reserved" });
  }
  const settings = await getAllSettings(c.var.db, c.var.schema);
  if (extraReservedFrom(settings).includes(slug.toLowerCase())) {
    return c.json({ available: false, reason: "reserved" });
  }
  // A domainId must be one of the caller's own usable domains — otherwise this
  // would leak slug availability across other users' custom-domain buckets.
  if (domainId) {
    const dom = await resolveLinkDomain(c.var.db, c.var.schema, c.var.user!.id, domainId);
    if ("error" in dom) return c.json({ available: false, reason: "reserved" });
  }
  // Availability is per-domain and spans live back-halves + retired aliases.
  const taken = await slugTaken(c.var.db, c.var.schema, domainId, slug);
  return c.json(taken ? { available: false, reason: "taken" } : { available: true });
});

route.get("/:id", async (c) => {
  const row = await getOwnedLink(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const [host, base] = await Promise.all([
    hostFor(c.var.db, c.var.schema, row.domainId),
    shortOrigin(c.env),
  ]);
  return c.json({ link: toLinkDTO(base, row, host) });
});

// History: a link's retired back-halves (still redirecting), newest first.
route.get("/:id/aliases", async (c) => {
  const link = await getOwnedLink(c);
  if (!link) return c.json({ error: "Not found" }, 404);
  const { linkAliases, domains } = c.var.schema;
  const [rows, base] = await Promise.all([
    c.var.db
      .select({
        id: linkAliases.id,
        slug: linkAliases.slug,
        domainHost: domains.hostname,
        createdAt: linkAliases.createdAt,
      })
      .from(linkAliases)
      .leftJoin(domains, eq(linkAliases.domainId, domains.id))
      .where(eq(linkAliases.linkId, link.id))
      .orderBy(desc(linkAliases.createdAt)),
    shortOrigin(c.env),
  ]);
  return c.json({
    aliases: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      domain: r.domainHost ?? null,
      shortUrl: buildShortUrl(base, r.domainHost ?? null, r.slug),
      createdAt: r.createdAt.toISOString(),
    })),
  });
});


// STATS (owner or admin)
route.get("/:id/stats", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  const user = c.var.user!;
  const { links } = c.var.schema;

  const rows = await c.var.db
    .select({
      id: links.id,
      userId: links.userId,
      createdAt: links.createdAt,
    })
    .from(links)
    .where(eq(links.id, id))
    .limit(1);
  const link = rows[0];
  // 404 for not-found AND not-owned, so existence is never confirmed.
  if (!link || (link.userId !== user.id && user.role !== "admin")) {
    return c.json({ error: "Not found" }, 404);
  }

  const stats = await computeStats(
    c.var.db,
    c.var.schema,
    c.var.dialect,
    id,
    parseRange(c.req.query("range")),
    link.createdAt,
  );
  return c.json(stats);
});

// ACTIVITY — the most recent human clicks, for the live feed on the stats page.
route.get("/:id/activity", async (c) => {
  const link = await getOwnedLink(c);
  if (!link) return c.json({ error: "Not found" }, 404);
  const { clicks } = c.var.schema;
  const rows = await c.var.db
    .select({
      at: clicks.createdAt,
      country: clicks.country,
      browser: clicks.browser,
      os: clicks.os,
      deviceType: clicks.deviceType,
      referrer: clicks.referrer,
    })
    .from(clicks)
    .where(and(eq(clicks.linkId, link.id), sql`${clicks.isBot} is not true`))
    .orderBy(desc(clicks.createdAt))
    .limit(20);
  return c.json({
    items: rows.map((r) => ({ ...r, at: r.at.toISOString() })),
  });
});

// EXPORT — the link's raw clicks (human + bot) as CSV, newest first, scoped to
// the range and capped by the admin `exportMaxRows` setting (which keeps the
// per-request CPU within budget). Owner-only, like the activity feed.
route.get("/:id/clicks.csv", async (c) => {
  const link = await getOwnedLink(c);
  if (!link) return c.json({ error: "Not found" }, 404);
  const cap = exportMaxRowsFrom(await getAllSettings(c.var.db, c.var.schema));
  if (cap <= 0) return c.json({ error: "Export is disabled" }, 403);

  const { clicks } = c.var.schema;
  const range = parseRange(c.req.query("range"));
  const start = rangeStart(range);
  const where = start
    ? (and(eq(clicks.linkId, link.id), gte(clicks.createdAt, start)) as SQL)
    : eq(clicks.linkId, link.id);
  const rows = await c.var.db
    .select({
      at: clicks.createdAt,
      country: clicks.country,
      referrer: clicks.referrer,
      device: clicks.deviceType,
      os: clicks.os,
      browser: clicks.browser,
      bot: clicks.isBot,
    })
    .from(clicks)
    .where(where)
    .orderBy(desc(clicks.createdAt))
    .limit(cap);

  const csv = toCsv(
    ["time", "country", "referrer", "device", "os", "browser", "bot"],
    rows.map((r) => [
      r.at.toISOString(),
      r.country,
      r.referrer,
      r.device,
      r.os,
      r.browser,
      r.bot ? "1" : "0",
    ]),
  );
  return c.body(csv, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="clicks-${link.slug}-${range}.csv"`,
    "cache-control": "no-store",
  });
});

// UPDATE
route.patch("/:id", zValidator("json", updateLinkSchema), async (c) => {
  const db = c.var.db;
  const schema = c.var.schema;
  const { links, linkAliases } = schema;
  const user = c.var.user!;
  const existing = await getOwnedLink(c);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const input = c.req.valid("json");

  // --- Editable back-half (slug) + domain. Changing either retires the old
  //     (domain, slug) to an alias so previously-shared links keep redirecting.
  let targetDomainId = existing.domainId;
  if (input.domainId !== undefined) {
    const dom = await resolveLinkDomain(db, schema, user.id, input.domainId);
    if ("error" in dom) return c.json({ error: dom.error }, 400);
    targetDomainId = input.domainId ?? null;
  }
  let targetSlug = existing.slug;
  if (input.slug !== undefined && input.slug !== existing.slug) {
    if (!isValidCustomSlug(input.slug)) {
      return c.json({ error: "That custom alias isn't allowed" }, 400);
    }
    targetSlug = input.slug;
  }
  const backHalfChanged =
    targetDomainId !== existing.domainId || targetSlug !== existing.slug;
  // Load settings once when the back-half changes (reserved check + alias cap).
  let settings: Record<string, unknown> | null = null;
  if (backHalfChanged) {
    settings = await getAllSettings(db, schema);
    if (
      targetSlug !== existing.slug &&
      extraReservedFrom(settings).includes(targetSlug.toLowerCase())
    ) {
      return c.json({ error: "That custom alias is reserved" }, 400);
    }
    if (await slugTaken(db, schema, targetDomainId, targetSlug, existing.id)) {
      return c.json({ error: "That custom alias is already taken" }, 409);
    }
    // Cap how many times a link's back-half may change. Reverting to one of this
    // link's own retired back-halves doesn't use up a new change.
    const cap = maxAliasesPerLinkFrom(settings);
    if (cap > 0) {
      const reverting =
        (
          await db
            .select({ id: linkAliases.id })
            .from(linkAliases)
            .where(
              and(
                eq(linkAliases.linkId, existing.id),
                eq(linkAliases.slug, targetSlug),
                domainBucket(linkAliases.domainId, targetDomainId),
              ),
            )
            .limit(1)
        ).length > 0;
      if (!reverting) {
        const [{ n }] = await db
          .select({ n: count() })
          .from(linkAliases)
          .where(eq(linkAliases.linkId, existing.id));
        if (Number(n) >= cap) {
          return c.json(
            { error: `This link’s back-half can be changed at most ${cap} times` },
            409,
          );
        }
      }
    }
  }

  // Enforce the destination blocklist on update too — create + import already
  // do, but the PATCH path skipped it, letting a link be re-pointed at a blocked
  // domain after creation (dashboard, /api/v1, and MCP all reach this handler).
  if (input.destination !== undefined) {
    settings ??= await getAllSettings(db, schema);
    if (isBlockedDestination(input.destination, blockedDomainsFrom(settings))) {
      return c.json({ error: "That destination domain isn’t allowed" }, 400);
    }
  }
  if (input.geoRules !== undefined && input.geoRules.length > 0) {
    settings ??= await getAllSettings(db, schema);
    if (
      input.geoRules.some((r) =>
        isBlockedDestination(r.url, blockedDomainsFrom(settings!)),
      )
    ) {
      return c.json({ error: "A country-routing destination domain isn’t allowed" }, 400);
    }
  }

  const patch: Partial<typeof links.$inferInsert> = { updatedAt: new Date() };
  if (input.destination !== undefined) patch.destination = input.destination;
  if (input.iosUrl !== undefined) patch.iosUrl = input.iosUrl;
  if (input.androidUrl !== undefined) patch.androidUrl = input.androidUrl;
  if (input.desktopUrl !== undefined) patch.desktopUrl = input.desktopUrl;
  if (input.geoRules !== undefined) patch.geoRules = input.geoRules;
  if (input.password !== undefined) {
    patch.passwordHash = input.password ? await hashPassword(input.password, c.env.SESSION_SECRET, pbkdf2Iterations(c.env)) : null;
  }
  if (input.qrConfig !== undefined) patch.qrConfig = input.qrConfig;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (input.expiresAt !== undefined) {
    patch.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  }
  if (input.previewMode !== undefined) patch.previewMode = input.previewMode;
  if (input.ogTitle !== undefined) patch.ogTitle = input.ogTitle;
  if (input.ogDescription !== undefined) patch.ogDescription = input.ogDescription;
  if (input.ogImage !== undefined) {
    patch.ogImage = await resolveOgImage(c.env, existing.id, input.ogImage);
  }
  if (input.projectId !== undefined) {
    patch.projectId = await resolveProjectId(
      db,
      schema,
      user.id,
      user.email,
      input.projectId,
    );
  }
  if (backHalfChanged) {
    patch.slug = targetSlug;
    patch.domainId = targetDomainId;
  }

  let row: LinkRow;
  try {
    row = (
      await db.update(links).set(patch).where(eq(links.id, existing.id)).returning()
    )[0];
  } catch (e) {
    if (isUniqueViolation(e)) {
      return c.json({ error: "That custom alias is already taken" }, 409);
    }
    throw e;
  }

  if (backHalfChanged) {
    // Reverting to one of this link's own old back-halves? Drop that alias row
    // so it doesn't duplicate the now-live one.
    await db
      .delete(linkAliases)
      .where(
        and(
          eq(linkAliases.linkId, existing.id),
          eq(linkAliases.slug, targetSlug),
          domainBucket(linkAliases.domainId, targetDomainId),
        ),
      );
    // Retire the previous (domain, slug) so old shared links keep redirecting.
    // The per-link change cap was already enforced above.
    await db
      .insert(linkAliases)
      .values({
        linkId: existing.id,
        domainId: existing.domainId,
        slug: existing.slug,
      })
      .onConflictDoNothing();
    // The old key no longer maps to a live back-half; clear it so a stale cache
    // can't serve it ahead of the alias lookup.
    await deleteCachedLink(c.env.LINKS_KV, existing.domainId, existing.slug);
  }

  // Warm every entry point (new back-half + retained aliases) with fresh data.
  await refreshLinkCache(c.env, db, schema, row);
  // Drop any cached destination preview so changes show on the next share.
  await invalidateLinkPreview(c.env, row.id);
  const [host, base] = await Promise.all([
    hostFor(db, schema, row.domainId),
    shortOrigin(c.env),
  ]);
  return c.json({ link: toLinkDTO(base, row, host) });
});

// DELETE
route.delete("/:id", async (c) => {
  const { links } = c.var.schema;
  const existing = await getOwnedLink(c);
  if (!existing) return c.json({ error: "Not found" }, 404);
  // Clear every entry point (live + aliases) before the cascade removes them.
  await purgeLinkCache(c.env, c.var.db, c.var.schema, existing);
  await c.var.db.delete(links).where(eq(links.id, existing.id));
  if (existing.ogImage === "r2") {
    await c.env.LOGO_BUCKET.delete(`og/${existing.id}`).catch(() => {});
  }
  return c.json({ ok: true });
});

export default route;
