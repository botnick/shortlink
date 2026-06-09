import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, count, desc, eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { generateApiKey, hashApiKey, invalidateApiKey } from "../lib/apikeys";
import { getAllSettings, maxApiKeysPerUserFrom } from "../lib/settings";
import { apiKeyCreateSchema } from "../lib/validators";
import { requireAuth } from "../middleware/auth";
import type { ApiKeyDTO, ApiKeyListDTO } from "@shared/types";

/**
 * API-key management. Session-only on purpose: a key must never be able to
 * mint or revoke keys, so a stolen key can't escalate or cover its tracks.
 */
const route = new Hono<AppEnv>();
route.use("*", requireAuth);
route.use("*", async (c, next) => {
  if (!c.var.sessionId) {
    return c.json({ error: "Manage API keys from the dashboard" }, 403);
  }
  await next();
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toDTO(row: {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}): ApiKeyDTO {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// LIST
route.get("/", async (c) => {
  const { apiKeys } = c.var.schema;
  const rows = await c.var.db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, c.var.user!.id))
    .orderBy(desc(apiKeys.createdAt));
  const body: ApiKeyListDTO = { keys: rows.map(toDTO) };
  return c.json(body);
});

// CREATE — returns the full key exactly once.
route.post("/", zValidator("json", apiKeyCreateSchema), async (c) => {
  const db = c.var.db;
  const { apiKeys } = c.var.schema;
  const user = c.var.user!;
  const { name } = c.req.valid("json");

  const settings = await getAllSettings(db, c.var.schema);
  const cap = maxApiKeysPerUserFrom(settings);
  if (cap > 0) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(apiKeys)
      .where(eq(apiKeys.userId, user.id));
    if (Number(n) >= cap) {
      return c.json({ error: `You’ve reached the API key limit (${cap})` }, 409);
    }
  }

  const { key, prefix } = generateApiKey();
  const keyHash = await hashApiKey(key);
  const row = (
    await db
      .insert(apiKeys)
      .values({ userId: user.id, name, keyHash, prefix })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
  )[0];
  return c.json({ key, apiKey: toDTO(row) }, 201);
});

// REVOKE — removes the key and drops its cached lookup so it stops working.
route.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  const { apiKeys } = c.var.schema;
  const removed = await c.var.db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, c.var.user!.id)))
    .returning({ keyHash: apiKeys.keyHash });
  if (!removed[0]) return c.json({ error: "Not found" }, 404);
  await invalidateApiKey(c.env, removed[0].keyHash);
  return c.json({ ok: true });
});

export default route;
