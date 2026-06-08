import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { AppContext } from "../env";

/**
 * In production (https) we use the hardened `__Host-` cookie prefix (forces
 * Secure + Path=/ + no Domain). Local dev runs over http://localhost where
 * Secure cookies are unreliable, so we fall back to a plain name there.
 */
const SECURE_NAME = "__Host-session";
const DEV_NAME = "session";

function cookieConfig(c: AppContext): { name: string; secure: boolean } {
  const secure = new URL(c.req.url).protocol === "https:";
  return { name: secure ? SECURE_NAME : DEV_NAME, secure };
}

export async function setSessionCookie(
  c: AppContext,
  value: string,
  expiresAt: Date,
): Promise<void> {
  const { name, secure } = cookieConfig(c);
  await setSignedCookie(c, name, value, c.env.SESSION_SECRET, {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "Lax",
    expires: expiresAt,
  });
}

export async function readSessionCookie(c: AppContext): Promise<string | null> {
  const { name } = cookieConfig(c);
  const value = await getSignedCookie(c, c.env.SESSION_SECRET, name);
  return typeof value === "string" ? value : null;
}

export function clearSessionCookie(c: AppContext): void {
  const { name, secure } = cookieConfig(c);
  deleteCookie(c, name, { path: "/", secure });
}
