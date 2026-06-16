/**
 * Phase D — transport (TLS) cohort soft-binding.
 *
 * `request.cf` exposes the connection's TLS version + cipher FOR FREE (no Bot
 * Management entitlement, so this stays $0). Cloudflare terminates TLS, so an
 * attacker can't fake these from JS, and a real browser's TLS stack differs
 * from curl / python-requests / a raw Go client even when the User-Agent header
 * is spoofed. This is the same class of signal Turnstile/reCAPTCHA lean on, the
 * part that lives below the JS the attacker controls.
 *
 * Everything here is SOFT — never a hard block. A genuine user can open a fresh
 * connection mid-challenge and renegotiate a different cipher (TLS1.2↔1.3,
 * AES↔ChaCha), and H2↔H3 can shift per request; an enterprise/VPN MITM can look
 * odd. So a mismatch only ADDS a small, capped amount to the behavioral score
 * (it can't reach the block threshold on its own), and token consume only logs/
 * escalates — it must never fail a real login.
 *
 * Two uses, both soft:
 *  1. Consistency — the cohort is captured when the challenge is minted and
 *     compared at /verify and at consume. A bot that mints in a headless
 *     browser then redeems from a `requests` loop shifts cohort.
 *  2. Coherence — a modern-browser UA riding an antique TLS version is a
 *     non-browser HTTP client wearing a browser costume.
 *
 * No TLS metadata is ever stored or logged: only an HMAC of it (the cohort).
 * When the edge gives us no TLS fields (local dev, or any non-edge request) the
 * cohort is "" and the whole layer is inert — it can never penalise a real
 * person running without Cloudflare in front.
 */
import type { AppBindings } from "../../env";
import { bytesToHex } from "../encoding";

export interface TransportEnv {
  /** e.g. "TLSv1.3" — `request.cf.tlsVersion`. */
  tlsVersion: string;
  /** e.g. "AEAD-AES128-GCM-SHA256" — `request.cf.tlsCipher`. */
  tlsCipher: string;
  ua: string;
}

/** Pull the transport inputs from a Hono request. `request.cf` is the free
 *  Cloudflare edge metadata (absent in local dev → fields read empty). */
export function transportEnvFromContext(c: {
  req: { header: (name: string) => string | undefined; raw: Request };
}): TransportEnv {
  const cf = (c.req.raw as { cf?: Record<string, unknown> }).cf;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    tlsVersion: str(cf?.tlsVersion),
    tlsCipher: str(cf?.tlsCipher),
    ua: c.req.header("user-agent") ?? "",
  };
}

/**
 * An opaque 16-hex cohort for this connection's transport, HMAC'd under the
 * server secret (no raw TLS fields ever leave this function). Returns "" unless
 * BOTH the TLS version and cipher are present, so a partial/absent edge never
 * produces a hashable-but-meaningless cohort.
 */
export async function transportCohort(env: AppBindings, t: TransportEnv): Promise<string> {
  if (!t.tlsVersion || !t.tlsCipher) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    // httpProtocol is deliberately excluded: browsers upgrade/shift H2↔H3 per
    // request, which would forge a cohort shift for a real user.
    new TextEncoder().encode(`hctp1|${t.tlsVersion}|${t.tlsCipher}`),
  );
  return bytesToHex(new Uint8Array(sig)).slice(0, 16);
}

/** TLS versions no current mainstream browser negotiates by default. */
const LEGACY_TLS = new Set(["TLSv1", "TLSv1.0", "TLSv1.1"]);

function isChromium(ua: string): boolean {
  return /(Chrome|Edg|OPR)\//.test(ua) && !/Firefox\//.test(ua);
}

export interface TransportSignal {
  score: number;
  reasons: string[];
}

/**
 * Soft transport signals. `stored` is the cohort captured when the challenge
 * was minted (null/"" = none yet); `current` is this request's cohort. Both
 * checks are bounded and small — they corroborate, never block alone.
 */
export function scoreTransport(
  stored: string | null | undefined,
  current: string,
  t: Pick<TransportEnv, "ua" | "tlsVersion">,
): TransportSignal {
  const reasons: string[] = [];
  let score = 0;

  // Cohort captured at mint vs. now — only when BOTH sides actually have a
  // cohort (dev / no-cf has "", so this never trips there).
  if (stored && current && stored !== current) {
    score += 16;
    reasons.push("transport-shift");
  }

  // A modern-browser UA on an antique TLS version: a scripted HTTP client.
  if (t.tlsVersion && isChromium(t.ua) && LEGACY_TLS.has(t.tlsVersion)) {
    score += 8;
    reasons.push("legacy-tls-for-chromium");
  }

  return { score, reasons };
}
