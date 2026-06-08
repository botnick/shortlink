import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { type SQL, and, count, desc, eq, gte, lt, sql, sum } from "drizzle-orm";
import type { AppEnv } from "../env";
import { deleteCachedLink, putCachedLink } from "../lib/cache";
import { dayBucket, searchCondition } from "../lib/query";
import {
  SETTING_KEYS,
  appNameFrom,
  brandColorFrom,
  descriptionFrom,
  getAllSettings,
  indexableFrom,
  logoFrom,
  ogImageFrom,
  setSetting,
  shortDomainFrom,
} from "../lib/settings";
import { invalidateSeo } from "../lib/seo";
import { settingsSchema, updateUserRoleSchema } from "../lib/validators";
import { requireAdmin } from "../middleware/auth";
import type {
  AdminLinkDTO,
  AdminOverviewDTO,
  AdminUserDTO,
  SettingsDTO,
} from "@shared/types";

const admin = new Hono<AppEnv>();
admin.use("*", requireAdmin);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 25;
const DAY_MS = 86_400_000;

function toSettingsDTO(map: Record<string, unknown>): SettingsDTO {
  return {
    registrationEnabled: map[SETTING_KEYS.registration] === true,
    appName: appNameFrom(map),
    shortDomain: shortDomainFrom(map),
    brandColor: brandColorFrom(map),
    logoUrl: logoFrom(map),
    description: descriptionFrom(map),
    ogImageUrl: ogImageFrom(map),
    indexable: indexableFrom(map),
  };
}

admin.get("/settings", async (c) => {
  const map = await getAllSettings(c.var.db, c.var.schema);
  return c.json(toSettingsDTO(map));
});

admin.patch("/settings", zValidator("json", settingsSchema), async (c) => {
  const db = c.var.db;
  const schema = c.var.schema;
  const input = c.req.valid("json");
  if (input.registrationEnabled !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.registration, input.registrationEnabled);
  }
  if (input.appName !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.appName, input.appName);
  }
  if (input.shortDomain !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.shortDomain, input.shortDomain);
  }
  if (input.brandColor !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.brandColor, input.brandColor);
  }
  if (input.logoUrl !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.logo, input.logoUrl);
  }
  if (input.description !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.description, input.description);
  }
  if (input.ogImageUrl !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.ogImage, input.ogImageUrl);
  }
  if (input.indexable !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.indexable, input.indexable);
  }
  await invalidateSeo(c.env.LINKS_KV);
  const map = await getAllSettings(db, schema);
  return c.json(toSettingsDTO(map));
});

admin.get("/users", async (c) => {
  const db = c.var.db;
  const { users, links } = c.var.schema;
  const q = c.req.query("q") ?? "";
  const cursor = c.req.query("cursor");

  const search = searchCondition([sql`${users.email}`], q);
  const cursorCond =
    cursor && !Number.isNaN(Date.parse(cursor))
      ? lt(users.createdAt, new Date(cursor))
      : undefined;
  const where = and(...([search, cursorCond].filter(Boolean) as SQL[]));

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        isPrimary: users.isPrimary,
        createdAt: users.createdAt,
        linkCount: count(links.id),
      })
      .from(users)
      .leftJoin(links, eq(links.userId, users.id))
      .where(where)
      .groupBy(users.id)
      .orderBy(desc(users.createdAt))
      .limit(PAGE + 1),
    db.select({ v: count() }).from(users).where(search).then((r) => Number(r[0]?.v ?? 0)),
  ]);

  const hasMore = rows.length > PAGE;
  const page = hasMore ? rows.slice(0, PAGE) : rows;
  const body: AdminUserDTO[] = page.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    isPrimary: r.isPrimary,
    createdAt: r.createdAt.toISOString(),
    linkCount: Number(r.linkCount),
  }));
  return c.json({
    users: body,
    nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    total: totalRow,
  });
});

// Promote/demote. The primary admin can never be demoted.
admin.patch("/users/:id", zValidator("json", updateUserRoleSchema), async (c) => {
  const id = c.req.param("id");
  if (!id || !UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);

  const { users } = c.var.schema;
  const { role } = c.req.valid("json");
  const rows = await c.var.db
    .select({ id: users.id, isPrimary: users.isPrimary })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  const target = rows[0];
  if (!target) return c.json({ error: "Not found" }, 404);
  if (target.isPrimary && role !== "admin") {
    return c.json({ error: "The primary admin can't be demoted" }, 403);
  }

  await c.var.db.update(users).set({ role }).where(eq(users.id, id));
  return c.json({ ok: true });
});

// System-wide overview for the admin dashboard.
admin.get("/overview", async (c) => {
  const db = c.var.db;
  const { links, users, clicks } = c.var.schema;
  const since7 = new Date(Date.now() - 7 * DAY_MS);
  const dayExpr = dayBucket(c.var.dialect, sql`${clicks.createdAt}`);

  const [linkAgg, activeAgg, userAgg, clicks7, newLinks7, top, series] =
    await Promise.all([
      db.select({ total: count(), clicks: sum(links.clickCount) }).from(links),
      db
        .select({ v: count() })
        .from(links)
        .where(eq(links.isActive, true))
        .then((r) => Number(r[0]?.v ?? 0)),
      db.select({ v: count() }).from(users).then((r) => Number(r[0]?.v ?? 0)),
      db
        .select({ v: count() })
        .from(clicks)
        .where(gte(clicks.createdAt, since7))
        .then((r) => Number(r[0]?.v ?? 0)),
      db
        .select({ v: count() })
        .from(links)
        .where(gte(links.createdAt, since7))
        .then((r) => Number(r[0]?.v ?? 0)),
      db
        .select({
          slug: links.slug,
          clickCount: links.clickCount,
          ownerEmail: users.email,
        })
        .from(links)
        .innerJoin(users, eq(links.userId, users.id))
        .orderBy(desc(links.clickCount))
        .limit(8),
      db
        .select({ day: dayExpr, value: count() })
        .from(clicks)
        .where(gte(clicks.createdAt, since7))
        .groupBy(dayExpr)
        .orderBy(dayExpr),
    ]);

  const body: AdminOverviewDTO = {
    totals: {
      links: Number(linkAgg[0]?.total ?? 0),
      clicks: Number(linkAgg[0]?.clicks ?? 0),
      users: userAgg,
      activeLinks: activeAgg,
    },
    clicks7d: clicks7,
    newLinks7d: newLinks7,
    topLinks: top.map((t) => ({
      slug: t.slug,
      clickCount: t.clickCount,
      ownerEmail: t.ownerEmail,
    })),
    timeseries: series.map((r) => ({ day: r.day, count: Number(r.value) })),
    dbDriver: c.var.dialect,
  };
  return c.json(body);
});

// All links across every user — keyset paginated + searchable.
admin.get("/links", async (c) => {
  const db = c.var.db;
  const { links, users } = c.var.schema;
  const q = c.req.query("q") ?? "";
  const cursor = c.req.query("cursor");

  const search = searchCondition(
    [sql`${links.slug}`, sql`${links.destination}`, sql`${links.title}`],
    q,
  );
  const cursorCond =
    cursor && !Number.isNaN(Date.parse(cursor))
      ? lt(links.createdAt, new Date(cursor))
      : undefined;
  const where = and(
    ...([search, cursorCond].filter(Boolean) as SQL[]),
  );

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: links.id,
        slug: links.slug,
        destination: links.destination,
        title: links.title,
        isActive: links.isActive,
        clickCount: links.clickCount,
        createdAt: links.createdAt,
        ownerEmail: users.email,
      })
      .from(links)
      .innerJoin(users, eq(links.userId, users.id))
      .where(where)
      .orderBy(desc(links.createdAt))
      .limit(PAGE + 1),
    db
      .select({ v: count() })
      .from(links)
      .where(search)
      .then((r) => Number(r[0]?.v ?? 0)),
  ]);

  const hasMore = rows.length > PAGE;
  const page = hasMore ? rows.slice(0, PAGE) : rows;
  const items: AdminLinkDTO[] = page.map((r) => ({
    id: r.id,
    slug: r.slug,
    shortUrl: `${c.env.APP_URL}/${r.slug}`,
    destination: r.destination,
    title: r.title,
    isActive: r.isActive,
    clickCount: r.clickCount,
    createdAt: r.createdAt.toISOString(),
    ownerEmail: r.ownerEmail,
  }));
  return c.json({
    links: items,
    nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    total: totalRow,
  });
});

// Admin can pause/activate any link.
admin.patch(
  "/links/:id",
  zValidator("json", z.object({ isActive: z.boolean() })),
  async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
    const { links } = c.var.schema;
    const { isActive } = c.req.valid("json");
    const rows = await c.var.db
      .update(links)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(links.id, id))
      .returning();
    const row = rows[0];
    if (!row) return c.json({ error: "Not found" }, 404);
    await putCachedLink(c.env.LINKS_KV, row.slug, {
      id: row.id,
      destination: row.destination,
      isActive: row.isActive,
      expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
    });
    return c.json({ ok: true });
  },
);

// Admin can delete any link.
admin.delete("/links/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  const { links } = c.var.schema;
  const rows = await c.var.db
    .delete(links)
    .where(eq(links.id, id))
    .returning({ slug: links.slug });
  if (!rows[0]) return c.json({ error: "Not found" }, 404);
  await deleteCachedLink(c.env.LINKS_KV, rows[0].slug);
  return c.json({ ok: true });
});

// Delete a user. The primary admin and your own account are protected.
admin.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  if (!id || !UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  if (id === c.var.user!.id) {
    return c.json({ error: "You can't delete your own account" }, 400);
  }

  const { users } = c.var.schema;
  const rows = await c.var.db
    .select({ isPrimary: users.isPrimary })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  const target = rows[0];
  if (!target) return c.json({ error: "Not found" }, 404);
  if (target.isPrimary) {
    return c.json({ error: "The primary admin can't be deleted" }, 403);
  }

  await c.var.db.delete(users).where(eq(users.id, id));
  return c.json({ ok: true });
});

export default admin;
