import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../env";
import { settings, users } from "../db/schema";
import { hashPassword } from "../lib/password";
import { createSession } from "../lib/auth";
import { setSessionCookie } from "../lib/cookies";
import { setupSchema } from "../lib/validators";
import { SETTING_KEYS } from "../lib/settings";
import { invalidateSeo } from "../lib/seo";
import { timingSafeEqual } from "../lib/encoding";
import type { UserDTO } from "@shared/types";

const setup = new Hono<AppEnv>();

class SetupAlreadyDone extends Error {}

async function tokenMatches(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

// First-run installer. Creates the admin + initial settings, then signs in.
setup.post("/", zValidator("json", setupSchema), async (c) => {
  const expected = c.env.SETUP_TOKEN;
  if (!expected) {
    return c.json({ error: "Setup is not configured on the server" }, 503);
  }

  const input = c.req.valid("json");
  if (!(await tokenMatches(input.token, expected))) {
    return c.json({ error: "Invalid setup token" }, 403);
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const user = await c.var.db.transaction(async (tx) => {
      // Atomically claim setup via the settings primary key — a second racing
      // request gets no row back and is rejected.
      const claim = await tx
        .insert(settings)
        .values({ key: SETTING_KEYS.setupCompleted, value: true })
        .onConflictDoNothing()
        .returning();
      if (claim.length === 0) throw new SetupAlreadyDone();

      const existing = await tx.select({ id: users.id }).from(users).limit(1);
      if (existing.length > 0) throw new SetupAlreadyDone();

      const inserted = await tx
        .insert(users)
        .values({ email: input.email, passwordHash, role: "admin", isPrimary: true })
        .returning({ id: users.id, email: users.email, role: users.role });

      const initial: [string, unknown][] = [
        [SETTING_KEYS.appName, input.appName],
        [SETTING_KEYS.shortDomain, input.shortDomain],
        [SETTING_KEYS.brandColor, input.brandColor],
        [SETTING_KEYS.registration, input.registrationEnabled],
      ];
      for (const [key, value] of initial) {
        await tx
          .insert(settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: settings.key, set: { value } });
      }

      return inserted[0];
    });

    await invalidateSeo(c.env.LINKS_KV);
    const session = await createSession(c.var.db, user.id);
    await setSessionCookie(c, session.id, session.expiresAt);
    const dto: UserDTO = user;
    return c.json({ user: dto }, 201);
  } catch (e) {
    if (e instanceof SetupAlreadyDone) {
      return c.json({ error: "Setup has already been completed" }, 409);
    }
    throw e;
  }
});

export default setup;
