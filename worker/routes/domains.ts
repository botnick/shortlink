import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import type { AppContext, AppEnv } from "../env";
import type { DomainRow } from "../db/schema";
import { domainSchema } from "../lib/validators";
import { requireAuth } from "../middleware/auth";
import {
  checkTxtVerification,
  newVerifyToken,
  verifyRecordName,
  verifyRecordValue,
} from "../lib/dns";
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
    verifyName: verifyRecordName(row.hostname),
    verifyValue: verifyRecordValue(row.verifyToken),
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
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

// LIST — the signed-in user's domains.
route.get("/", async (c) => {
  const { domains } = c.var.schema;
  const rows = await c.var.db
    .select()
    .from(domains)
    .where(eq(domains.userId, c.var.user!.id))
    .orderBy(desc(domains.createdAt));
  const body: DomainListDTO = { domains: rows.map(toDTO) };
  return c.json(body);
});

// ADD — register a domain (pending) with a DNS TXT challenge to prove ownership.
route.post("/", zValidator("json", domainSchema), async (c) => {
  const { domains } = c.var.schema;
  const user = c.var.user!;
  const { hostname } = c.req.valid("json");

  const existing = await c.var.db
    .select({ id: domains.id })
    .from(domains)
    .where(eq(domains.userId, user.id));
  if (existing.length >= MAX_PER_USER) {
    return c.json({ error: "You've reached the domain limit" }, 409);
  }

  try {
    const row = (
      await c.var.db
        .insert(domains)
        .values({ userId: user.id, hostname, verifyToken: newVerifyToken() })
        .returning()
    )[0];
    return c.json({ domain: toDTO(row) }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) {
      return c.json({ error: "That domain is already added" }, 409);
    }
    throw e;
  }
});

// VERIFY — look up the DNS TXT record and mark the domain verified if it matches.
route.post("/:id/verify", async (c) => {
  const row = await ownedDomain(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (row.status === "verified") return c.json({ domain: toDTO(row) });

  const ok = await checkTxtVerification(row.hostname, row.verifyToken);
  if (!ok) {
    return c.json(
      { error: "TXT record not found yet — DNS can take a few minutes" },
      400,
    );
  }
  const { domains } = c.var.schema;
  const updated = (
    await c.var.db
      .update(domains)
      .set({ status: "verified", verifiedAt: new Date() })
      .where(eq(domains.id, row.id))
      .returning()
  )[0];
  return c.json({ domain: toDTO(updated) });
});

// DELETE
route.delete("/:id", async (c) => {
  const row = await ownedDomain(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const { domains } = c.var.schema;
  await c.var.db.delete(domains).where(eq(domains.id, row.id));
  return c.json({ ok: true });
});

export default route;
