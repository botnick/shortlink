import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq, ne } from "drizzle-orm";
import type { AppContext, AppEnv, AppBindings } from "../env";
import type { ProjectRow } from "../db/schema";
import { projectCreateSchema, projectUpdateSchema } from "../lib/validators";
import { ensureDefaultProject } from "../lib/projects";
import { requireAuth } from "../middleware/auth";
import type { ProjectDTO, ProjectListDTO } from "@shared/types";

const route = new Hono<AppEnv>();
route.use("*", requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Store a project logo in R2 (keyed by project id). Returns the column value:
 *  "r2", an http URL, or "" (none). Mirrors links' resolveOgImage. */
async function resolveLogo(
  env: AppBindings,
  projectId: string,
  value: string | null | undefined,
): Promise<string> {
  const key = `projlogo/${projectId}`;
  if (!value) {
    await env.LOGO_BUCKET.delete(key).catch(() => {});
    return "";
  }
  if (value === `/api/projects/${projectId}/logo`) return "r2"; // unchanged pointer
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
    return "";
  }
}

function logoUrl(id: string, stored: string | null): string | null {
  if (stored === "r2") return `/api/projects/${id}/logo`;
  return stored && stored.startsWith("http") ? stored : null;
}

function toDTO(row: ProjectRow, linkCount: number, isDefault: boolean): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    color: row.color || null,
    logo: logoUrl(row.id, row.logo),
    linkCount,
    isDefault,
    createdAt: row.createdAt.toISOString(),
  };
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
  const row = (
    await c.var.db
      .insert(projects)
      .values({ userId: c.var.user!.id, name: input.name, color: input.color || null, logo: "" })
      .returning()
  )[0];
  if (input.logo) {
    const logo = await resolveLogo(c.env, row.id, input.logo);
    if (logo) {
      row.logo = logo;
      await c.var.db.update(projects).set({ logo }).where(eq(projects.id, row.id));
    }
  }
  return c.json({ project: toDTO(row, 0, false) }, 201);
});

// SERVE a project's logo bytes from R2 (owner only; cookie-authed <img>).
route.get("/:id/logo", async (c) => {
  const proj = await ownedProject(c);
  if (!proj || proj.logo !== "r2") return new Response("Not found", { status: 404 });
  const obj = await c.env.LOGO_BUCKET.get(`projlogo/${proj.id}`);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/png",
      "cache-control": "private, max-age=3600",
    },
  });
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
  if (input.logo !== undefined) patch.logo = await resolveLogo(c.env, proj.id, input.logo);

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

// DELETE — reassigns this project's links to the oldest remaining project.
route.delete("/:id", async (c) => {
  const proj = await ownedProject(c);
  if (!proj) return c.json({ error: "Not found" }, 404);
  const user = c.var.user!;
  const { projects, links } = c.var.schema;

  const target = await c.var.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, user.id), ne(projects.id, proj.id)))
    .orderBy(asc(projects.createdAt))
    .limit(1);
  if (!target[0]) {
    return c.json({ error: "You need to keep at least one project" }, 409);
  }

  await c.var.db
    .update(links)
    .set({ projectId: target[0].id })
    .where(and(eq(links.userId, user.id), eq(links.projectId, proj.id)));
  if (proj.logo === "r2") {
    await c.env.LOGO_BUCKET.delete(`projlogo/${proj.id}`).catch(() => {});
  }
  await c.var.db.delete(projects).where(eq(projects.id, proj.id));
  return c.json({ ok: true, reassignedTo: target[0].id });
});

export default route;
