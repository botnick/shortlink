import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { type SQL, and, desc, eq, lt, sql } from "drizzle-orm";
import type { AppContext, AppEnv, AppBindings } from "../env";
import type { LinkRow } from "../db/schema";
import { createLinkSchema, updateLinkSchema } from "../lib/validators";
import { generateSlug, isValidCustomSlug } from "../lib/slug";
import { deleteCachedLink, putCachedLink, type CachedLink } from "../lib/cache";
import { searchCondition } from "../lib/query";
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
    title: row.title,
    isActive: row.isActive,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    clickCount: row.clickCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function cachePayload(row: LinkRow): CachedLink {
  return {
    id: row.id,
    destination: row.destination,
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
  const where = and(
    eq(links.userId, user.id),
    ...([search, cursorCond].filter(Boolean) as SQL[]),
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
  const { links } = c.var.schema;
  const user = c.var.user!;
  const input = c.req.valid("json");
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

  const insertOne = async (slug: string) => {
    const row = (
      await db
        .insert(links)
        .values({
          slug,
          destination: input.destination,
          userId: user.id,
          title: input.title ?? null,
          expiresAt,
        })
        .returning()
    )[0];
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
  if (input.title !== undefined) patch.title = input.title;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (input.expiresAt !== undefined) {
    patch.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  }

  const row = (
    await db.update(links).set(patch).where(eq(links.id, existing.id)).returning()
  )[0];
  await putCachedLink(c.env.LINKS_KV, row.slug, cachePayload(row));
  return c.json({ link: toLinkDTO(c.env, row) });
});

// DELETE
route.delete("/:id", async (c) => {
  const { links } = c.var.schema;
  const existing = await getOwnedLink(c);
  if (!existing) return c.json({ error: "Not found" }, 404);
  await c.var.db.delete(links).where(eq(links.id, existing.id));
  await deleteCachedLink(c.env.LINKS_KV, existing.slug);
  return c.json({ ok: true });
});

export default route;
