import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import type { AppContext, AppEnv } from "../env";
import type { DomainRow } from "../db/schema";
import { domainSchema } from "../lib/validators";
import { requireAuth } from "../middleware/auth";
import {
  getAllSettings,
  maxDomainsPerUserFrom,
  saasConfigFrom,
  type SaasConfig,
} from "../lib/settings";
import {
  checkTxtVerification,
  newVerifyToken,
  verifyRecordName,
  verifyRecordValue,
} from "../lib/dns";
import {
  createCustomHostname,
  deleteCustomHostname,
  getCustomHostname,
} from "../lib/cloudflare";
import { invalidateDomainHost } from "../lib/domainScope";
import type { DomainDnsRecord, DomainDTO, DomainListDTO } from "@shared/types";

const route = new Hono<AppEnv>();
route.use("*", requireAuth);

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function loadSaas(c: AppContext): Promise<SaasConfig | null> {
  const map = await getAllSettings(c.var.db, c.var.schema);
  return saasConfigFrom(map, c.env.APP_URL, c.env.SESSION_SECRET);
}

function toDTO(saas: boolean, row: DomainRow): DomainDTO {
  const records: DomainDnsRecord[] =
    saas && row.cfRecords
      ? (row.cfRecords as DomainDnsRecord[])
      : [
          {
            type: "TXT",
            name: verifyRecordName(row.hostname),
            value: verifyRecordValue(row.verifyToken),
          },
        ];
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    mode: saas ? "saas" : "dns",
    records,
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

function isForeignKeyViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return (
    err?.code === "23503" ||
    err?.cause?.code === "23503" ||
    /foreign key|FOREIGN KEY/i.test(String((e as Error)?.message))
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

// LIST
route.get("/", async (c) => {
  const saas = await loadSaas(c);
  const { domains } = c.var.schema;
  const rows = await c.var.db
    .select()
    .from(domains)
    .where(eq(domains.userId, c.var.user!.id))
    .orderBy(desc(domains.createdAt));
  const body: DomainListDTO = {
    mode: saas ? "saas" : "dns",
    domains: rows.map((r) => toDTO(Boolean(saas), r)),
  };
  return c.json(body);
});

// ADD — SaaS: register with Cloudflare (CNAME + TXT, auto TLS). Otherwise issue
// a DNS-TXT ownership challenge.
route.post("/", zValidator("json", domainSchema), async (c) => {
  const { domains } = c.var.schema;
  const user = c.var.user!;
  const { hostname } = c.req.valid("json");
  const map = await getAllSettings(c.var.db, c.var.schema);
  const saas = await saasConfigFrom(map, c.env.APP_URL, c.env.SESSION_SECRET);
  const cap = maxDomainsPerUserFrom(map);

  const existing = await c.var.db
    .select({ id: domains.id })
    .from(domains)
    .where(eq(domains.userId, user.id));
  if (cap > 0 && existing.length >= cap) {
    return c.json({ error: "You’ve reached the domain limit" }, 409);
  }

  let cfHostnameId: string | null = null;
  let cfRecords: DomainDnsRecord[] | null = null;
  let status = "pending";
  if (saas) {
    try {
      const cf = await createCustomHostname(saas, hostname);
      cfHostnameId = cf.cfId;
      cfRecords = cf.records;
      status = cf.status;
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  }

  try {
    const row = (
      await c.var.db
        .insert(domains)
        .values({
          userId: user.id,
          hostname,
          verifyToken: newVerifyToken(),
          status,
          cfHostnameId,
          cfRecords,
        })
        .returning()
    )[0];
    await invalidateDomainHost(c.env.LINKS_KV, hostname);
    return c.json({ domain: toDTO(Boolean(saas), row) }, 201);
  } catch (e) {
    if (saas && cfHostnameId) await deleteCustomHostname(saas, cfHostnameId).catch(() => {});
    if (isUniqueViolation(e)) return c.json({ error: "That domain is already added" }, 409);
    throw e;
  }
});

// CHECK — SaaS: poll Cloudflare. DNS: verify the TXT record.
route.post("/:id/check", async (c) => {
  const row = await ownedDomain(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const { domains } = c.var.schema;
  const saas = await loadSaas(c);

  if (saas && row.cfHostnameId) {
    try {
      const cf = await getCustomHostname(saas, row.cfHostnameId);
      const updated = (
        await c.var.db
          .update(domains)
          .set({ status: cf.status, cfRecords: cf.records })
          .where(eq(domains.id, row.id))
          .returning()
      )[0];
      return c.json({ domain: toDTO(true, updated) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  }

  if (row.status === "verified") return c.json({ domain: toDTO(false, row) });
  const ok = await checkTxtVerification(row.hostname, row.verifyToken);
  if (!ok) {
    return c.json({ error: "TXT record not found yet — DNS can take a few minutes" }, 400);
  }
  const updated = (
    await c.var.db
      .update(domains)
      .set({ status: "verified", verifiedAt: new Date() })
      .where(eq(domains.id, row.id))
      .returning()
  )[0];
  return c.json({ domain: toDTO(false, updated) });
});

// DELETE
route.delete("/:id", async (c) => {
  const row = await ownedDomain(c);
  if (!row) return c.json({ error: "Not found" }, 404);
  const { domains } = c.var.schema;
  // A domain can't be removed while links still point at it (FK). Surface that
  // as a clear message instead of a 500.
  try {
    await c.var.db.delete(domains).where(eq(domains.id, row.id));
  } catch (e) {
    if (isForeignKeyViolation(e)) {
      return c.json(
        { error: "Move or delete this domain’s links before removing it" },
        409,
      );
    }
    throw e;
  }
  if (row.cfHostnameId) {
    const saas = await loadSaas(c);
    if (saas) await deleteCustomHostname(saas, row.cfHostnameId).catch(() => {});
  }
  await invalidateDomainHost(c.env.LINKS_KV, row.hostname);
  return c.json({ ok: true });
});

export default route;
