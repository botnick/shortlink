import { and, asc, eq, isNull } from "drizzle-orm";
import type { DB, DbSchema } from "../db";

/** The user's default project is their oldest one, created lazily (named after
 *  their email) the first time and backfilling any project-less links. */
export async function ensureDefaultProject(
  db: DB,
  schema: DbSchema,
  userId: string,
  email: string,
): Promise<string> {
  const { projects, links } = schema;
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(asc(projects.createdAt))
    .limit(1);
  if (rows[0]) return rows[0].id;
  const created = (await db.insert(projects).values({ userId, name: email }).returning())[0];
  await db
    .update(links)
    .set({ projectId: created.id })
    .where(and(eq(links.userId, userId), isNull(links.projectId)));
  return created.id;
}

/** Resolve the project a link should live in: the requested one if the user owns
 *  it, otherwise their default project. */
export async function resolveProjectId(
  db: DB,
  schema: DbSchema,
  userId: string,
  email: string,
  requested?: string,
): Promise<string> {
  if (requested) {
    const { projects } = schema;
    const owned = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, requested), eq(projects.userId, userId)))
      .limit(1);
    if (owned[0]) return owned[0].id;
  }
  return ensureDefaultProject(db, schema, userId, email);
}
