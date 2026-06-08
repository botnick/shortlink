import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, count, desc, eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import type { QrPresetRow } from "../db/schema";
import { qrPresetSchema } from "../lib/validators";
import { requireAuth } from "../middleware/auth";
import type { QrPresetDTO } from "@shared/types";

const route = new Hono<AppEnv>();
route.use("*", requireAuth);

const MAX_PRESETS = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toDTO(row: QrPresetRow): QrPresetDTO {
  return {
    id: row.id,
    name: row.name,
    config: row.config as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

// LIST — the signed-in user's presets, newest first.
route.get("/", async (c) => {
  const { qrPresets } = c.var.schema;
  const rows = await c.var.db
    .select()
    .from(qrPresets)
    .where(eq(qrPresets.userId, c.var.user!.id))
    .orderBy(desc(qrPresets.createdAt));
  return c.json({ presets: rows.map(toDTO) });
});

// CREATE
route.post("/", zValidator("json", qrPresetSchema), async (c) => {
  const db = c.var.db;
  const { qrPresets } = c.var.schema;
  const user = c.var.user!;
  const input = c.req.valid("json");

  const [{ n }] = await db
    .select({ n: count() })
    .from(qrPresets)
    .where(eq(qrPresets.userId, user.id));
  if (Number(n) >= MAX_PRESETS) {
    return c.json({ error: "You've reached the preset limit" }, 409);
  }

  const row = (
    await db
      .insert(qrPresets)
      .values({ userId: user.id, name: input.name, config: input.config })
      .returning()
  )[0];
  return c.json({ preset: toDTO(row) }, 201);
});

// UPDATE (overwrite an existing preset with the current design)
route.patch("/:id", zValidator("json", qrPresetSchema), async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  const { qrPresets } = c.var.schema;
  const input = c.req.valid("json");
  const rows = await c.var.db
    .update(qrPresets)
    .set({ name: input.name, config: input.config })
    .where(and(eq(qrPresets.id, id), eq(qrPresets.userId, c.var.user!.id)))
    .returning();
  if (!rows[0]) return c.json({ error: "Not found" }, 404);
  return c.json({ preset: toDTO(rows[0]) });
});

// DELETE (own only)
route.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  const { qrPresets } = c.var.schema;
  await c.var.db
    .delete(qrPresets)
    .where(and(eq(qrPresets.id, id), eq(qrPresets.userId, c.var.user!.id)));
  return c.json({ ok: true });
});

export default route;
