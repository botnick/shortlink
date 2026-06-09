import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import type { AppContext, AppEnv } from "../env";
import type { DomainRow } from "../db/schema";
import { domainSchema } from "../lib/validators";
import { requireAuth } from "../middleware/auth";
import {
  createCustomHostname,
  customDomainsEnabled,
  deleteCustomHostname,
  getCustomHostname,
} from "../lib/cloudflare";
import type { DomainDTO, DomainListDTO } from "@shared/types";

const route = new Hono<AppEnv>();
route.use("*", requireAuth);

const MAX_PER_USER = 10;
const UUID_RE = /^[0-9a-f-]{36}$/i;

function toDTO(row: DomainRow): DomainDTO {
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    records: (row.verification as DomainDTO["records"]) ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return (
    err?.code === "23505" ||
    err?.cause?.code === "23505" ||
    /unique|constraint/i.test(String((e as Error)?.message))
  );
}

// LIST — the signed-in user's domains + whether the feature is configured.
route.get("/", async (c) => {
  const { domains } = c.var.schema;
  const rows = await c.var.db
    .select()
    .from(domains)
    .where(eq(domains.userId, c.var.user!.id))
    .orderBy(desc(domains.createdAt));
  const body: DomainListDTO = {
    enabled: customDomainsEnabled(c.env),
    fallbackHost: c.env.CF_FALLBACK_HOST ?? "",
    domains: rows.map(toDTO),
  };
  return c.json(body);
});

// ADD — register the hostname with Cloudflare for SaaS, store the DNS records.
route.post("/", zValidator("json", domainSchema), async (c) => {
  if (!customDomainsEnabled(c.env)) {
    return c.json({ error: "Custom domains aren’t enabled on this server" }, 503);
  }
  const { domains } = c.var.schema;
  const user = c.var.user!;
  const { hostname } = c.req.valid("json");

  const [{ n }] = await c.var.db
    .select({ n: domains.id })
    .from(domains)
    .where(eq(domains.userId, user.id))
    .then((r) => [{ n: r.length }]);
  if (n >= MAX_PER_USER) {
    return c.json({ error: "You've reached the domain limit" }, 409);
  }

  let cf;
  try {
    cf = await createCustomHostname(c.env, hostname);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }

  try {
    const row = (
      await c.var.db
        .insert(domains)
        .values({
          userId: user.id,
          hostname,
          status: cf.status,
          cfHostnameId: cf.cfId,
          verification: cf.records,
        })
        .returning()
    )[0];
    return c.json({ domain: toDTO(row) }, 201);
  } catch (e) {
    // Roll back the Cloudflare hostname if we couldn't persist it.
    await deleteCustomHostname(c.env, cf.cfId).catch(() => {});
    if (isUniqueViolation(e)) {
      return c.json({ error: "That domain is already added" }, 409);
    }
    throw e;
  }
});

async function ownedDomain(c: AppContext): Promise<DomainRow | null> {
  const id = c.req.param("id");
  if (!id || !UUID_RE.test(id)) return null;
  const { domains } = c.var.schema;
  const rows = await c.var.db
    .select()
    .from(domains)
    .where(and(eq(domains.id, id), eq(domains.userId, c.var.user!.id)))
    .limit(1);
  return rows[0] ?? null;
}

// REFRESH — re-check verification/SSL status with Cloudflare.
route.post("/:id/refresh", async (c) => {
  const row = await ownedDomain(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!customDomainsEnabled(c.env) || !row.cfHostnameId) {
    return c.json({ domain: toDTO(row) });
  }
  try {
    const cf = await getCustomHostname(c.env, row.cfHostnameId);
    const { domains } = c.var.schema;
    const updated = (
      await c.var.db
        .update(domains)
        .set({ status: cf.status, verification: cf.records })
        .where(eq(domains.id, row.id))
        .returning()
    )[0];
    return c.json({ domain: toDTO(updated) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// DELETE — remove from Cloudflare and our DB.
route.delete("/:id", async (c) => {
  const row = await ownedDomain(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.cfHostnameId && customDomainsEnabled(c.env)) {
    await deleteCustomHostname(c.env, row.cfHostnameId).catch(() => {});
  }
  const { domains } = c.var.schema;
  await c.var.db.delete(domains).where(eq(domains.id, row.id));
  return c.json({ ok: true });
});

export default route;
