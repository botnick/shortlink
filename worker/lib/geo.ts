import type { AppContext } from "../env";
import { bytesToHex } from "./encoding";

export function getCountry(c: AppContext): string | null {
  const cf = c.req.raw.cf as { country?: string } | undefined;
  return cf?.country ?? null;
}

export function getReferrer(c: AppContext): string | null {
  const r = c.req.header("referer");
  return r ? r.slice(0, 500) : null;
}

export function getClientIp(c: AppContext): string | null {
  return c.req.header("cf-connecting-ip") ?? null;
}

/** Privacy: store a salted, truncated SHA-256 of the IP — never the raw IP. */
export async function hashIp(
  ip: string | null,
  salt: string,
): Promise<string | null> {
  if (!ip) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(ip + salt),
  );
  return bytesToHex(new Uint8Array(digest)).slice(0, 32);
}

export interface UAInfo {
  browser: string | null;
  os: string | null;
  deviceType: string | null;
}

/** Lightweight User-Agent parsing — no heavyweight dependency. */
export function parseUserAgent(ua: string | null): UAInfo {
  if (!ua) return { browser: null, os: null, deviceType: null };

  let os: string | null = null;
  if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Mac OS X/i.test(ua)) os = "macOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser: string | null = null;
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  let deviceType: string;
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    deviceType = "tablet";
  } else if (/Mobi|iPhone|iPod/i.test(ua)) {
    deviceType = "mobile";
  } else {
    deviceType = "desktop";
  }

  return { browser, os, deviceType };
}
