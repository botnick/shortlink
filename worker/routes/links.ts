import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { type SQL, and, count, desc, eq, lt, sql } from "drizzle-orm";
import type { AppContext, AppEnv, AppBindings } from "../env";
import type { LinkRow } from "../db/schema";
import { createLinkSchema, updateLinkSchema } from "../lib/validators";
import { generateSlug, isValidCustomSlug } from "../lib/slug";
import { deleteCachedLink, putCachedLink, type CachedLink } from "../lib/cache";
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
  if (value === `${env.APP_URL}/ogimg/${linkId}`) return "r2";
  if (value.startsWith("http")) return value;
  const m = /^data:([^;]+);base64,(.+)$/.exec(value);
  if (!m) return "";
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await env.LOGO_BUCKET.put(key, bytes, { httpMetadata: { contentType: m[1] } });
    return "r2";
  } catch {
    return ""; // malformed image → store nothing rather than failing the request
  }
}
import {
  blockedDomainsFrom,
  extraReservedFrom,
  getAllSettings,
  isBlockedDestination,
  maxLinksPerUserFrom,
} from "../lib/settings";
import { requireAuth } from "../middleware/auth";
import { computeStats, parseRange } from "./stats";
import type { LinkDTO, LinkListDTO } from "@shared/types";

const route = new Hono<AppEnv>();
route.use("*", requireAuth);

const PAGE_SIZE = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toLinkDTO(env: AppBindings, row: LinkRow): LinkDTO {
  return {
    id: row.id,
    slug: row.slug,
    shortUrl: `${env.APP_URL}/${row.slug}`,
    destination: row.destination,
    iosUrl: row.iosUrl,
    androidUrl: row.androidUrl,
    desktopUrl: row.desktopUrl,
    title: row.title,
    isActive: row.isActive,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    clickCount: row.clickCount,
    previewMode: (row.previewMode as LinkDTO["previewMode"]) ?? "off",
    ogTitle: row.ogTitle,
    ogDescription: row.ogDescription,
    ogImage:
      row.ogImage === "r2"
        ? `${env.APP_URL}/ogimg/${row.id}`
        : row.ogImage || null,
    projectId: row.projectId,
    createdAt: row.createdAt.toISOString(),
  };
}

function cachePayload(row: LinkRow): CachedLink {
  return {
    id: row.id,
    destination: row.destination,
    iosUrl: row.iosUrl,
    androidUrl: row.androidUrl,
    desktopUrl: row.desktopUrl,
    isActive: row.isActive,
    expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
  };
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

  const search = searchCondition(
    [sql`${links.slug}`, sql`${links.destination}`, sql`${links.title}`],
    q,
  );
  const cursorCond =
    cursor && !Number.isNaN(Date.parse(cursor))
      ? lt(links.createdAt, new Date(cursor))
      : undefined;
  const projectId = c.req.query("projectId");
  const projectCond =
    projectId && UUID_RE.test(projectId) ? eq(links.projectId, projectId) : undefined;
  const where = and(
    eq(links.userId, user.id),
    ...([search, cursorCond, projectCond].filter(Boolean) as SQL[]),
  );

  const rows = await c.var.db
    .select()
    .from(links)
    .where(where)
    .orderBy(desc(links.createdAt))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const body: LinkListDTO = {
    links: page.map((r) => toLinkDTO(c.env, r)),
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

  // Place the link in the requested project (if owned) or the user's default.
  const projectId = await resolveProjectId(db, schema, user.id, user.email, input.projectId);

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
          userId: user.id,
          projectId,
          title: input.title ?? null,
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
    await putCachedLink(c.env.LINKS_KV, row.slug, cachePayload(row));
    return row;
  };

  if (input.slug) {
    if (!isValidCustomSlug(input.slug)) {
      return c.json({ error: "That custom alias isn't allowed" }, 400);
    }
    try {
      const row = await insertOne(input.slug);
      return c.json({ link: toLinkDTO(c.env, row) }, 201);
    } catch (e) {
      if (isUniqueViolation(e)) {
        return c.json({ error: "That custom alias is already taken" }, 409);
      }
      throw e;
    }
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const row = await insertOne(generateSlug());
      return c.json({ link: toLinkDTO(c.env, row) }, 201);
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
  }
  return c.json({ error: "Could not generate a unique slug, please retry" }, 500);
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

// READ one
route.get("/:id", async (c) => {
  const row = await getOwnedLink(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ link: toLinkDTO(c.env, row) });
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

// UPDATE
route.patch("/:id", zValidator("json", updateLinkSchema), async (c) => {
  const db = c.var.db;
  const { links } = c.var.schema;
  const existing = await getOwnedLink(c);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const input = c.req.valid("json");
  const patch: Partial<typeof links.$inferInsert> = { updatedAt: new Date() };
  if (input.destination !== undefined) patch.destination = input.destination;
  if (input.iosUrl !== undefined) patch.iosUrl = input.iosUrl;
  if (input.androidUrl !== undefined) patch.androidUrl = input.androidUrl;
  if (input.desktopUrl !== undefined) patch.desktopUrl = input.desktopUrl;
  if (input.title !== undefined) patch.title = input.title;
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
      c.var.schema,
      c.var.user!.id,
      c.var.user!.email,
      input.projectId,
    );
  }

  const row = (
    await db.update(links).set(patch).where(eq(links.id, existing.id)).returning()
  )[0];
  await putCachedLink(c.env.LINKS_KV, row.slug, cachePayload(row));
  // Drop any cached destination preview so changes show on the next share.
  await invalidateLinkPreview(c.env, row.id);
  return c.json({ link: toLinkDTO(c.env, row) });
});

// DELETE
route.delete("/:id", async (c) => {
  const { links } = c.var.schema;
  const existing = await getOwnedLink(c);
  if (!existing) return c.json({ error: "Not found" }, 404);
  await c.var.db.delete(links).where(eq(links.id, existing.id));
  await deleteCachedLink(c.env.LINKS_KV, existing.slug);
  if (existing.ogImage === "r2") {
    await c.env.LOGO_BUCKET.delete(`og/${existing.id}`).catch(() => {});
  }
  return c.json({ ok: true });
});

export default route;
