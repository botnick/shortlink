import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq, ne } from "drizzle-orm";
import type { AppContext, AppEnv } from "../env";
import type { ProjectRow } from "../db/schema";
import { projectCreateSchema, projectUpdateSchema } from "../lib/validators";
import { ensureDefaultProject } from "../lib/projects";
import { purgeLinkCache } from "../lib/linkCache";
import { requireAuth } from "../middleware/auth";
import type { ProjectDTO, ProjectListDTO } from "@shared/types";

const route = new Hono<AppEnv>();
route.use("*", requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A project logo is small and there are only a few per account, so it's kept
 *  inline (a data URL or http URL) — no R2 round-trip, and it renders without an
 *  authenticated image request. */
function cleanLogo(value: string | null | undefined): string {
  if (!value) return "";
  return value.startsWith("data:image/") || value.startsWith("http") ? value : "";
}

function bytesToDataUrl(bytes: Uint8Array, type: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:${type};base64,${btoa(bin)}`;
}

function toDTO(row: ProjectRow, linkCount: number, isDefault: boolean): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    color: row.color || null,
    logo:
      row.logo && (row.logo.startsWith("data:") || row.logo.startsWith("http"))
        ? row.logo
        : null,
    defaultDomainId: row.defaultDomainId,
    linkCount,
    isDefault,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A domain id the user owns, or null/undefined (= clear / not set). */
async function ownsDomain(c: AppContext, domainId: string | null | undefined) {
  if (!domainId) return true;
  const { domains } = c.var.schema;
  const r = await c.var.db
    .select({ id: domains.id })
    .from(domains)
    .where(and(eq(domains.id, domainId), eq(domains.userId, c.var.user!.id)))
    .limit(1);
  return r.length > 0;
}

async function ownedProject(c: AppContext): Promise<ProjectRow | null> {
  const id = c.req.param("id");
  if (!id || !UUID_RE.test(id)) return null;
  const { projects } = c.var.schema;
  const rows = await c.var.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, c.var.user!.id)))
    .limit(1);
  return rows[0] ?? null;
}

// LIST — ensures a default project exists, with per-project link counts.
route.get("/", async (c) => {
  const user = c.var.user!;
  const { projects, links } = c.var.schema;
  const defaultId = await ensureDefaultProject(c.var.db, c.var.schema, user.id, user.email);

  const [rows, counts] = await Promise.all([
    c.var.db
      .select()
      .from(projects)
      .where(eq(projects.userId, user.id))
      .orderBy(asc(projects.createdAt)),
    c.var.db
      .select({ pid: links.projectId, n: count() })
      .from(links)
      .where(eq(links.userId, user.id))
      .groupBy(links.projectId),
  ]);

  // Migrate any legacy R2-stored logos to inline data URLs (one-time), freeing R2.
  for (const r of rows) {
    if (r.logo === "r2") {
      const key = `projlogo/${r.id}`;
      const obj = await c.env.LOGO_BUCKET.get(key);
      r.logo = obj
        ? bytesToDataUrl(
            new Uint8Array(await obj.arrayBuffer()),
            obj.httpMetadata?.contentType ?? "image/png",
          )
        : "";
      await c.var.db.update(projects).set({ logo: r.logo }).where(eq(projects.id, r.id));
      c.executionCtx.waitUntil(c.env.LOGO_BUCKET.delete(key).catch(() => {}));
    }
  }

  const countMap = new Map(counts.map((r) => [r.pid, Number(r.n)]));
  const body: ProjectListDTO = {
    projects: rows.map((r) => toDTO(r, countMap.get(r.id) ?? 0, r.id === defaultId)),
    defaultProjectId: defaultId,
  };
  return c.json(body);
});

// CREATE
route.post("/", zValidator("json", projectCreateSchema), async (c) => {
  const { projects } = c.var.schema;
  const input = c.req.valid("json");
  if (!(await ownsDomain(c, input.defaultDomainId))) {
    return c.json({ error: "That domain isn’t available" }, 400);
  }
  const row = (
    await c.var.db
      .insert(projects)
      .values({
        userId: c.var.user!.id,
        name: input.name,
        color: input.color || null,
        logo: cleanLogo(input.logo),
        defaultDomainId: input.defaultDomainId ?? null,
      })
      .returning()
  )[0];
  return c.json({ project: toDTO(row, 0, false) }, 201);
});

// UPDATE (name / color / logo)
route.patch("/:id", zValidator("json", projectUpdateSchema), async (c) => {
  const proj = await ownedProject(c);
  if (!proj) return c.json({ error: "Not found" }, 404);
  const { projects, links } = c.var.schema;
  const input = c.req.valid("json");

  const patch: Partial<typeof projects.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.color !== undefined) patch.color = input.color || null;
  if (input.logo !== undefined) patch.logo = cleanLogo(input.logo);
  if (input.defaultDomainId !== undefined) {
    if (!(await ownsDomain(c, input.defaultDomainId))) {
      return c.json({ error: "That domain isn’t available" }, 400);
    }
    patch.defaultDomainId = input.defaultDomainId ?? null;
  }

  const row = (
    await c.var.db.update(projects).set(patch).where(eq(projects.id, proj.id)).returning()
  )[0];

  const [{ n }] = await c.var.db
    .select({ n: count() })
    .from(links)
    .where(eq(links.projectId, proj.id));
  const defaultId = await ensureDefaultProject(c.var.db, c.var.schema, c.var.user!.id, c.var.user!.email);
  return c.json({ project: toDTO(row, Number(n), row.id === defaultId) });
});

// DELETE — any project (even the default) as long as one remains. Its links are
// either moved to a chosen project (?action=move&to=<id>, default) or deleted
// outright (?action=delete).
route.delete("/:id", async (c) => {
  const proj = await ownedProject(c);
  if (!proj) return c.json({ error: "Not found" }, 404);
  const user = c.var.user!;
  const db = c.var.db;
  const { projects, links } = c.var.schema;
  const action = c.req.query("action");
  const to = c.req.query("to");

  const others = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, user.id), ne(projects.id, proj.id)))
    .orderBy(asc(projects.createdAt));
  if (others.length === 0) {
    return c.json({ error: "You need to keep at least one project" }, 409);
  }

  if (action === "delete") {
    const doomed = await db
      .select({
        id: links.id,
        slug: links.slug,
        domainId: links.domainId,
        ogImage: links.ogImage,
      })
      .from(links)
      .where(and(eq(links.userId, user.id), eq(links.projectId, proj.id)));
    // Purge every entry point's cache before the delete cascades the aliases.
    await Promise.all(doomed.map((l) => purgeLinkCache(c.env, db, c.var.schema, l)));
    await db.delete(links).where(and(eq(links.userId, user.id), eq(links.projectId, proj.id)));
    c.executionCtx.waitUntil(
      Promise.all(
        doomed
          .filter((l) => l.ogImage === "r2")
          .map((l) => c.env.LOGO_BUCKET.delete(`og/${l.id}`).catch(() => {})),
      ).then(() => {}),
    );
  } else {
    const target = (to && others.find((o) => o.id === to)?.id) || others[0].id;
    await db
      .update(links)
      .set({ projectId: target })
      .where(and(eq(links.userId, user.id), eq(links.projectId, proj.id)));
  }

  await db.delete(projects).where(eq(projects.id, proj.id));
  return c.json({ ok: true });
});

export default route;
