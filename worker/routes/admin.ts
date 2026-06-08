import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { count, desc, eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { links, users } from "../db/schema";
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
import type { AdminUserDTO, SettingsDTO } from "@shared/types";

const admin = new Hono<AppEnv>();
admin.use("*", requireAdmin);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const map = await getAllSettings(c.var.db);
  return c.json(toSettingsDTO(map));
});

admin.patch("/settings", zValidator("json", settingsSchema), async (c) => {
  const db = c.var.db;
  const input = c.req.valid("json");
  if (input.registrationEnabled !== undefined) {
    await setSetting(db, SETTING_KEYS.registration, input.registrationEnabled);
  }
  if (input.appName !== undefined) {
    await setSetting(db, SETTING_KEYS.appName, input.appName);
  }
  if (input.shortDomain !== undefined) {
    await setSetting(db, SETTING_KEYS.shortDomain, input.shortDomain);
  }
  if (input.brandColor !== undefined) {
    await setSetting(db, SETTING_KEYS.brandColor, input.brandColor);
  }
  if (input.logoUrl !== undefined) {
    await setSetting(db, SETTING_KEYS.logo, input.logoUrl);
  }
  if (input.description !== undefined) {
    await setSetting(db, SETTING_KEYS.description, input.description);
  }
  if (input.ogImageUrl !== undefined) {
    await setSetting(db, SETTING_KEYS.ogImage, input.ogImageUrl);
  }
  if (input.indexable !== undefined) {
    await setSetting(db, SETTING_KEYS.indexable, input.indexable);
  }
  await invalidateSeo(c.env.LINKS_KV);
  const map = await getAllSettings(db);
  return c.json(toSettingsDTO(map));
});

admin.get("/users", async (c) => {
  const rows = await c.var.db
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
    .groupBy(users.id)
    .orderBy(desc(users.isPrimary), desc(users.createdAt));

  const body: AdminUserDTO[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    isPrimary: r.isPrimary,
    createdAt: r.createdAt.toISOString(),
    linkCount: Number(r.linkCount),
  }));
  return c.json({ users: body });
});

// Promote/demote. The primary admin can never be demoted.
admin.patch("/users/:id", zValidator("json", updateUserRoleSchema), async (c) => {
  const id = c.req.param("id");
  if (!id || !UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);

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

// Delete a user. The primary admin and your own account are protected.
admin.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  if (!id || !UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  if (id === c.var.user!.id) {
    return c.json({ error: "You can't delete your own account" }, 400);
  }

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
