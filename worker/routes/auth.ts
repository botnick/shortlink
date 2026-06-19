import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import type { AppContext, AppEnv, SessionUser } from "../env";
import { createSession, invalidateSession } from "../lib/auth";
import { getDbHandle } from "../db";
import { hashPassword, needsRehash, pbkdf2Iterations, verifyPassword } from "../lib/password";
import { clearSessionCookie, setSessionCookie } from "../lib/cookies";
import {
  SETTING_KEYS,
  authRateLimitFrom,
  challengeModeFrom,
  getAllSettings,
} from "../lib/settings";
import { consumeHumanToken } from "../lib/captcha/service";
import { recordCheckFailure } from "../lib/captcha/escalation";
import type { CaptchaAction } from "@shared/captcha";
import { isEmailBlocked } from "../lib/accountLifecycle";
import { counterBump, counterGet, isRateLimited } from "../lib/ratelimit";
import { getClientIp, getCountry, parseUserAgent } from "../lib/geo";
import type { AppContext as Ctx } from "../env";

/** Device snapshot for the session list on the account page. */
function sessionMeta(c: Ctx) {
  const ua = parseUserAgent(c.req.header("user-agent") ?? null);
  return { ...ua, country: getCountry(c) };
}
import { loginSchema, registerSchema } from "../lib/validators";
import type { UserDTO } from "@shared/types";

export const AUTH_WINDOW_SEC = 15 * 60; // attempts counted per 15-minute window per IP
// Failed-login caps that survive IP rotation (the per-IP limit above can't).
// DO-only counters, keyed by user id (never email), so they add zero KV budget.
const ACCT_FAIL_LIMIT = 30; // total failed logins per account / 15 min
const PAIR_FAIL_LIMIT = 10; // failed logins per (IP + account) / 15 min

/** Shared per-IP throttle for the auth endpoints. */
async function authThrottled(c: AppContext, map: Record<string, unknown>) {
  return isRateLimited(c.env, `auth:${getClientIp(c)}`, authRateLimitFrom(map), AUTH_WINDOW_SEC);
}

interface ChallengeEvidence {
  humanToken?: string;
  website?: string;
}

/**
 * The human check shared by sign-in and sign-up. The heavy lifting (games,
 * proof-of-work, interaction risk) already happened in /api/captcha/*; what
 * arrives here is a one-time verification token, redeemed ATOMICALLY and bound
 * to this exact action + hostname + caller. The protected action never runs on
 * a token that is missing, expired, replayed, or minted for anything else.
 * Always fails generically — the reason is never disclosed.
 */
async function verifyHumanity(
  c: AppContext,
  map: Record<string, unknown>,
  body: ChallengeEvidence,
  action: CaptchaAction,
): Promise<boolean> {
  const ip = getClientIp(c) ?? "";
  const fail = async () => {
    // Feed the adaptive escalator — this IP's next challenge costs double.
    c.executionCtx.waitUntil(recordCheckFailure(c.env, ip).catch(() => {}));
    return false;
  };
  if (body.website) return fail(); // honeypot
  const mode = challengeModeFrom(map);
  if (mode === "disabled") return true;
  // Fail closed: when verification is on, no token (or a service hiccup while
  // checking one) means no account action — auth is a high-stakes path.
  if (!(await consumeHumanToken(c, body.humanToken, action).catch(() => false))) {
    return fail();
  }
  return true;
}

const auth = new Hono<AppEnv>();

function toUserDTO(u: SessionUser): UserDTO {
  return { id: u.id, email: u.email, role: u.role };
}

// The v2 GET /challenge endpoint is gone: the human check now lives at
// /api/captcha/challenge + /api/captcha/verify (worker/routes/captcha.ts).

auth.post("/register", zValidator("json", registerSchema), async (c) => {
  const db = c.var.db;
  const schema = c.var.schema;
  const { users } = schema;
  const map = await getAllSettings(db, schema);
  if (await authThrottled(c, map)) {
    return c.json({ error: "Too many attempts — please try again later" }, 429, {
      "Retry-After": String(AUTH_WINDOW_SEC),
    });
  }
  if (map[SETTING_KEYS.registration] !== true) {
    return c.json({ error: "Registration is currently closed" }, 403);
  }

  const body = c.req.valid("json");
  const { email, password } = body;

  if (!(await verifyHumanity(c, map, body, "register"))) {
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
    await hashPassword(password, c.env.SESSION_SECRET, pbkdf2Iterations(c.env)); // equalize timing
    return c.json({ error: "Unable to register with those details" }, 409);
  }

  const passwordHash = await hashPassword(password, c.env.SESSION_SECRET, pbkdf2Iterations(c.env));
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
    return c.json({ error: "Too many attempts — please try again later" }, 429, {
      "Retry-After": String(AUTH_WINDOW_SEC),
    });
  }
  const body = c.req.valid("json");
  const { email, password } = body;

  if (!(await verifyHumanity(c, map, body, "login"))) {
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
    await hashPassword(password, c.env.SESSION_SECRET, pbkdf2Iterations(c.env));
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // Failed-login throttle that survives IP rotation: caps attempts per account
  // and per (IP + account). Checked BEFORE the expensive hash so a grinder can't
  // burn CPU. DO-only (zero KV budget). Keyed by user id, never the email.
  const ip = getClientIp(c) ?? "";
  const acctKey = `authfail:user:${user.id}`;
  const pairKey = `authfail:pair:${ip}:${user.id}`;
  if (
    (await counterGet(c.env, acctKey, true)) >= ACCT_FAIL_LIMIT ||
    (await counterGet(c.env, pairKey, true)) >= PAIR_FAIL_LIMIT
  ) {
    return c.json({ error: "Too many attempts — please try again later" }, 429, {
      "Retry-After": String(AUTH_WINDOW_SEC),
    });
  }

  // A closed (soft-deleted) account can never sign in; verify first so the
  // timing matches a wrong password, and keep the message generic.
  const valid = await verifyPassword(password, user.passwordHash, c.env.SESSION_SECRET);
  if (!valid || user.deletedAt) {
    // Count the failure against both buckets (DO-only).
    await counterBump(c.env, acctKey, AUTH_WINDOW_SEC, true);
    await counterBump(c.env, pairKey, AUTH_WINDOW_SEC, true);
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // Upgrade a legacy / lower-cost hash to the current peppered scheme on a
  // successful login — off the response path, with its own DB handle (the
  // request handle is closed in waitUntil after we respond).
  if (needsRehash(user.passwordHash, pbkdf2Iterations(c.env))) {
    c.executionCtx.waitUntil(
      (async () => {
        const upgraded = await hashPassword(password, c.env.SESSION_SECRET, pbkdf2Iterations(c.env));
        const { db: db2, schema, close } = getDbHandle(c.env);
        try {
          await db2
            .update(schema.users)
            .set({ passwordHash: upgraded })
            .where(eq(schema.users.id, user.id));
        } finally {
          await close();
        }
      })().catch(() => {}),
    );
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
