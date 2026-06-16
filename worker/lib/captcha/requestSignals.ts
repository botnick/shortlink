/**
 * Phase A — server-side request signals (free at the Cloudflare edge).
 *
 * The interaction risk engine looks at HOW the pointer moved; this looks at WHO
 * is connecting, using fields Cloudflare populates on `request.cf` for FREE
 * (ASN, HTTP protocol) plus header coherence — signals that live below the JS
 * the attacker controls, so a `requests`/`curl`/headless script can't simply
 * fake them by editing client code. (The paid Bot Management fields —
 * `cf.botManagement.score`, JA3 — are deliberately NOT used; this stays $0.)
 *
 * Same discipline as the behavioral engine: every signal is SOFT and small, no
 * single one blocks, and we never punish a real person. A VPN user (datacenter
 * ASN), a privacy browser, Linux, or a non-Chromium browser must pass clean —
 * weights are tuned so only a COMBINATION typical of a scripted non-browser
 * client adds up, and even then it only ADDS to the behavioral score.
 */

/** A handful of well-known cloud/hosting ASNs where automated traffic lives.
 *  Not exhaustive and not a blocklist — a soft nudge only (real users behind a
 *  VPN land here too, so it can never reject on its own). */
const DATACENTER_ASNS = new Set<number>([
  16509, 14618, // Amazon AWS
  8075, // Microsoft Azure
  15169, // Google Cloud (also consumer — kept low-weight for that reason)
  14061, // DigitalOcean
  16276, // OVH
  24940, // Hetzner
  63949, // Akamai/Linode
  20473, // Vultr/Choopa
  39629, // (hosting)
  9009, // M247
  51167, // Contabo
  45102, // Alibaba Cloud
  132203, // Tencent
]);

export interface RequestEnv {
  ua: string;
  acceptLanguage: string | null;
  secFetchSite: string | null;
  secChUa: string | null;
  httpProtocol: string;
  asn?: number;
}

interface RequestSignal {
  score: number;
  reasons: string[];
}

/** True for a UA string that claims a real browser engine. */
function looksLikeBrowser(ua: string): boolean {
  return /Mozilla\/5\.0/.test(ua) && /(Chrome|Firefox|Safari|Edg|OPR)\//.test(ua);
}

function isChromium(ua: string): boolean {
  return /(Chrome|Edg|OPR)\//.test(ua) && !/Firefox\//.test(ua);
}

/**
 * Pure, unit-testable scorer. Inputs are primitives so it can be exercised
 * without a live Hono context.
 */
export function scoreRequest(r: RequestEnv): RequestSignal {
  const reasons: string[] = [];
  let score = 0;
  const add = (n: number, why: string) => {
    score += n;
    reasons.push(why);
  };

  const browserUa = looksLikeBrowser(r.ua);

  // A request claiming a browser but missing the headers EVERY real browser
  // attaches to a same-origin fetch is almost certainly a script with a forged
  // UA. Each alone is mild; together they corroborate.
  if (browserUa && !r.acceptLanguage) add(14, "no-accept-language");
  if (browserUa && !r.secFetchSite) add(14, "no-sec-fetch");
  // Sec-CH-UA is Chromium-only — only expect it from a Chromium UA, so Firefox
  // and Safari are never penalized.
  if (isChromium(r.ua) && !r.secChUa) add(10, "no-sec-ch-ua");

  // Modern Chrome/Edge negotiate HTTP/2 or /3; a "Chrome" UA on HTTP/1.x is a
  // tell of a non-browser HTTP client wearing a browser UA.
  if (isChromium(r.ua) && (r.httpProtocol === "HTTP/1.0" || r.httpProtocol === "HTTP/1.1")) {
    add(8, "old-http-for-chromium");
  }

  // Datacenter ASN: a soft nudge (VPN users live here too — never a block).
  if (r.asn !== undefined && DATACENTER_ASNS.has(r.asn)) add(10, "datacenter-asn");

  return { score, reasons };
}

/** Extract the signal inputs from a Hono request. `request.cf` is the free
 *  Cloudflare edge metadata (absent in local dev → fields just read empty). */
export function requestEnvFromContext(c: {
  req: { header: (name: string) => string | undefined; raw: Request };
}): RequestEnv {
  const cf = (c.req.raw as { cf?: Record<string, unknown> }).cf;
  const asn = typeof cf?.asn === "number" ? cf.asn : undefined;
  const httpProtocol = typeof cf?.httpProtocol === "string" ? cf.httpProtocol : "";
  return {
    ua: c.req.header("user-agent") ?? "",
    acceptLanguage: c.req.header("accept-language") ?? null,
    secFetchSite: c.req.header("sec-fetch-site") ?? null,
    secChUa: c.req.header("sec-ch-ua") ?? null,
    httpProtocol,
    asn,
  };
}
