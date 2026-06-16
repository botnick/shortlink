import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../env";
import { hashPassword, pbkdf2Iterations } from "../lib/password";
import { createSession } from "../lib/auth";
import { setSessionCookie } from "../lib/cookies";
import { setupSchema } from "../lib/validators";
import { SETTING_KEYS } from "../lib/settings";
import { invalidateSeo } from "../lib/seo";
import { invalidatePublicConfig } from "../lib/appconfig";
import { timingSafeEqual } from "../lib/encoding";
import { isRateLimited } from "../lib/ratelimit";
import { getClientIp } from "../lib/geo";
import type { UserDTO } from "@shared/types";

// Throttle setup-token guessing: a handful of attempts per IP per 15 min. The
// claim insert makes setup one-shot, but this stops a brute-force before then.
const SETUP_WINDOW_SEC = 15 * 60;
const SETUP_MAX_ATTEMPTS = 10;
// Reject a low-entropy SETUP_TOKEN outright so a guessable value can't be the
// only thing standing between an attacker and the first admin account.
const MIN_SETUP_TOKEN_LEN = 24;

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
  if (!expected || expected.length < MIN_SETUP_TOKEN_LEN) {
    // Missing or weak token → refuse rather than accept a guessable secret.
    return c.json({ error: "Setup is not configured on the server" }, 503);
  }

  if (
    await isRateLimited(
      c.env,
      `setup:${getClientIp(c)}`,
      SETUP_MAX_ATTEMPTS,
      SETUP_WINDOW_SEC,
    )
  ) {
    return c.json({ error: "Too many attempts — please try again later" }, 429);
  }

  const input = c.req.valid("json");
  if (!(await tokenMatches(input.token, expected))) {
    return c.json({ error: "Invalid setup token" }, 403);
  }

  const passwordHash = await hashPassword(input.password, c.env.SESSION_SECRET, pbkdf2Iterations(c.env));
  const db = c.var.db;
  const { settings, users } = c.var.schema;

  try {
    // Atomically claim setup via the settings primary key — a second racing
    // request gets no row back and is rejected. (No interactive transaction so
    // the same path works on D1, which doesn't support them; the claim insert
    // is itself the race guard.)
    const claim = await db
      .insert(settings)
      .values({ key: SETTING_KEYS.setupCompleted, value: true })
      .onConflictDoNothing()
      .returning();
    if (claim.length === 0) throw new SetupAlreadyDone();

    const existing = await db.select({ id: users.id }).from(users).limit(1);
    if (existing.length > 0) throw new SetupAlreadyDone();

    const inserted = await db
      .insert(users)
      .values({ email: input.email, passwordHash, role: "admin", isPrimary: true })
      .returning({ id: users.id, email: users.email, role: users.role });

    const initial: [string, unknown][] = [
      [SETTING_KEYS.appName, input.appName],
      [SETTING_KEYS.brandColor, input.brandColor],
      [SETTING_KEYS.registration, input.registrationEnabled],
    ];
    for (const [key, value] of initial) {
      await db
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } });
    }

    const user = inserted[0];
    await invalidateSeo(c.env.LINKS_KV);
    await invalidatePublicConfig(c.env.LINKS_KV);
    const session = await createSession(db, c.var.schema, user.id);
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
