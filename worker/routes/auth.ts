import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import type { AppContext, AppEnv, SessionUser } from "../env";
import { createSession, invalidateSession } from "../lib/auth";
import { hashPassword, verifyPassword } from "../lib/password";
import { clearSessionCookie, setSessionCookie } from "../lib/cookies";
import {
  SETTING_KEYS,
  authRateLimitFrom,
  challengeModeFrom,
  getAllSettings,
  powDifficultyFrom,
} from "../lib/settings";
import { issueChallenge, verifyGame, verifySolution } from "../lib/pow";
import { isEmailBlocked } from "../lib/accountLifecycle";
import { isRateLimited } from "../lib/ratelimit";
import { getClientIp, getCountry, parseUserAgent } from "../lib/geo";
import type { AppContext as Ctx } from "../env";

/** Device snapshot for the session list on the account page. */
function sessionMeta(c: Ctx) {
  const ua = parseUserAgent(c.req.header("user-agent") ?? null);
  return { ...ua, country: getCountry(c) };
}
import { loginSchema, registerSchema } from "../lib/validators";
import type { UserDTO } from "@shared/types";

const AUTH_WINDOW_SEC = 15 * 60; // attempts counted per 15-minute window per IP

/** Shared per-IP throttle for the auth endpoints. */
async function authThrottled(c: AppContext, map: Record<string, unknown>) {
  return isRateLimited(c.env, `auth:${getClientIp(c)}`, authRateLimitFrom(map), AUTH_WINDOW_SEC);
}

interface ChallengeEvidence {
  challenge?: string;
  solution?: string;
  gamePos?: number;
  gameDuration?: number;
  gameMoves?: number;
  website?: string;
}

/**
 * The human check shared by sign-in and sign-up. Layers, all of which must
 * pass when enabled: honeypot empty → proof-of-work (HMAC-signed, IP-bound,
 * single-use, real CPU burned) → in game mode, the slider released on the
 * server-chosen target with human-looking motion. Always fails generically.
 */
async function verifyHumanity(
  c: AppContext,
  map: Record<string, unknown>,
  body: ChallengeEvidence,
): Promise<boolean> {
  if (body.website) return false; // honeypot
  const mode = challengeModeFrom(map);
  if (mode === "off") return true;
  const difficulty = powDifficultyFrom(map);
  if (difficulty > 0) {
    const ok = await verifySolution(
      c.env,
      getClientIp(c) ?? "",
      difficulty,
      body.challenge,
      body.solution,
    );
    if (!ok) return false;
  }
  if (mode === "game") {
    return verifyGame(body.challenge ?? "", {
      pos: body.gamePos,
      duration: body.gameDuration,
      moves: body.gameMoves,
    });
  }
  return true;
}

const auth = new Hono<AppEnv>();

function toUserDTO(u: SessionUser): UserDTO {
  return { id: u.id, email: u.email, role: u.role };
}

// Sign-up bot deterrence: hand the browser a proof-of-work puzzle it solves
// silently in the background (humans never interact with it).
auth.get("/challenge", async (c) => {
  const map = await getAllSettings(c.var.db, c.var.schema);
  const difficulty = powDifficultyFrom(map);
  if (difficulty <= 0) return c.json({ challenge: null, difficulty: 0 });
  return c.json(await issueChallenge(c.env, getClientIp(c) ?? "", difficulty));
});

auth.post("/register", zValidator("json", registerSchema), async (c) => {
  const db = c.var.db;
  const schema = c.var.schema;
  const { users } = schema;
  const map = await getAllSettings(db, schema);
  if (await authThrottled(c, map)) {
    return c.json({ error: "Too many attempts — please try again later" }, 429);
  }
  if (map[SETTING_KEYS.registration] !== true) {
    return c.json({ error: "Registration is currently closed" }, 403);
  }

  const body = c.req.valid("json");
  const { email, password } = body;

  if (!(await verifyHumanity(c, map, body))) {
    return c.json({ error: "Verification failed — please try again" }, 403);
  }

  const { deletedAccounts } = schema;
  const [existing, tombstone] = await Promise.all([
    db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1),
    db
      .select({ deletedAt: deletedAccounts.deletedAt })
      .from(deletedAccounts)
      .where(eq(deletedAccounts.email, email))
      .limit(1),
  ]);

  // Taken, or inside a closed account's no-register window. One generic
  // message for both — the reason is never disclosed.
  if (
    existing.length > 0 ||
    (tombstone[0] && isEmailBlocked(tombstone[0].deletedAt, map))
  ) {
    await hashPassword(password); // equalize timing
    return c.json({ error: "Unable to register with those details" }, 409);
  }

  const passwordHash = await hashPassword(password);
  const inserted = await db
    .insert(users)
    .values({ email, passwordHash })
    .returning({ id: users.id, email: users.email, role: users.role });

  const user = inserted[0];
  const session = await createSession(db, schema, user.id, sessionMeta(c));
  await setSessionCookie(c, session.id, session.expiresAt);
  return c.json({ user: toUserDTO(user) }, 201);
});

auth.post("/login", zValidator("json", loginSchema), async (c) => {
  const db = c.var.db;
  const { users } = c.var.schema;
  const map = await getAllSettings(db, c.var.schema);
  if (await authThrottled(c, map)) {
    return c.json({ error: "Too many attempts — please try again later" }, 429);
  }
  const body = c.req.valid("json");
  const { email, password } = body;

  if (!(await verifyHumanity(c, map, body))) {
    return c.json({ error: "Verification failed — please try again" }, 403);
  }

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      passwordHash: users.passwordHash,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const user = rows[0];
  if (!user) {
    // Burn equivalent time so unknown accounts aren't distinguishable.
    await hashPassword(password);
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // A closed (soft-deleted) account can never sign in; verify first so the
  // timing matches a wrong password, and keep the message generic.
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid || user.deletedAt) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const session = await createSession(db, c.var.schema, user.id, sessionMeta(c));
  await setSessionCookie(c, session.id, session.expiresAt);
  return c.json({ user: toUserDTO(user) });
});

auth.post("/logout", async (c) => {
  if (c.var.sessionId)
    await invalidateSession(c.var.db, c.var.schema, c.var.sessionId);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

auth.get("/me", (c) => c.json({ user: c.var.user }));

export default auth;
