import type { AppBindings } from "../env";

// User-agents of the link-unfurling crawlers used by social platforms + chat
// apps. These get an OG-tagged HTML page; everyone else gets the fast redirect.
const BOTS = [
  /facebookexternalhit/i,
  /facebot/i,
  /twitterbot/i,
  /linkedinbot/i,
  /slackbot/i,
  /telegrambot/i,
  /whatsapp/i,
  /discordbot/i,
  /pinterest/i,
  /redditbot/i,
  /skypeuripreview/i,
  /vkshare/i,
  /embedly/i,
  /line-?podcast|line\//i,
  /bitlybot/i,
  /applebot/i,
  /googlebot|google-inspectiontool/i,
  /bingbot/i,
];

export function isCrawler(ua: string | null): boolean {
  return ua ? BOTS.some((re) => re.test(ua)) : false;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface Preview {
  title: string;
  description: string;
  image: string;
}

/** A tiny OG/Twitter-card HTML doc for crawlers, with a redirect fallback so a
 *  real browser that somehow lands here still continues to the destination.
 *  `pageUrl` is our own short-link URL — used as og:url so the unfurled card is
 *  attributed to us (our domain + site name), not the destination, even when the
 *  title/description/image are pulled from the destination page. */
export function previewHtml(
  p: Preview,
  destination: string,
  siteName: string,
  pageUrl: string,
): string {
  const title = p.title;
  const m: string[] = [
    `<meta name="robots" content="noindex">`,
    `<title>${esc(title)}</title>`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(siteName)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:url" content="${esc(pageUrl)}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
  ];
  if (p.description) {
    m.push(`<meta name="description" content="${esc(p.description)}">`);
    m.push(`<meta property="og:description" content="${esc(p.description)}">`);
    m.push(`<meta name="twitter:description" content="${esc(p.description)}">`);
  }
  if (p.image) {
    const img = esc(p.image);
    m.push(`<meta property="og:image" content="${img}">`);
    if (p.image.startsWith("https:")) {
      m.push(`<meta property="og:image:secure_url" content="${img}">`);
    }
    m.push(`<meta property="og:image:alt" content="${esc(title)}">`);
    m.push(`<meta name="twitter:image" content="${img}">`);
    m.push(`<meta name="twitter:image:alt" content="${esc(title)}">`);
    m.push(`<meta name="twitter:card" content="summary_large_image">`);
  } else {
    m.push(`<meta name="twitter:card" content="summary">`);
  }
  const dest = esc(destination);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${m.join("")}<meta http-equiv="refresh" content="0;url=${dest}"></head><body><a href="${dest}">Continue</a><script>location.replace(${JSON.stringify(destination)})</script></body></html>`;
}

// Common named HTML entities found in <title>/<meta> text. Numeric ones
// (decimal &#064; and hex &#x2022;) are handled generically below.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", middot: "·", bull: "•",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  copy: "©", reg: "®", trade: "™", deg: "°",
};

/** Decode HTML entities in scraped meta text/URLs so the preview shows real
 *  characters (e.g. `&#064;` → "@", `&#x2022;` → "•", `&amp;` → "&"). Worker
 *  has no DOM, so this is a small hand-rolled decoder for the common cases. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => cp(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}
function cp(n: number): string {
  try {
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

function pick(html: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return decodeEntities(m[1].trim()).slice(0, 300);
  }
  return "";
}

/**
 * Guard for server-side preview fetches: only public http(s) URLs. Blocks
 * loopback / private / link-local hosts as defence-in-depth. Cloudflare's edge
 * already won't route a Worker fetch to private networks or cloud metadata
 * (Workers aren't on a VM), so this is belt-and-suspenders, not the only line —
 * and deliberately not a DNS-rebind defence (the platform's lack of
 * private-network egress is the real backstop). Returns the URL or null.
 */
function publicFetchUrl(rawUrl: string): URL | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "::" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^f[cd][0-9a-f]{2}:/i.test(h) ||
    /^fe80:/i.test(h)
  ) {
    return null;
  }
  return u;
}

/** Fetch the destination's own OG tags (cached in KV per link for a day). */
export async function destinationPreview(
  env: AppBindings,
  linkId: string,
  destination: string,
): Promise<Preview> {
  const key = `linkog:v2:${linkId}`;
  const cached = await env.LINKS_KV.get<Preview>(key, "json");
  if (cached) return cached;

  const empty: Preview = { title: "", description: "", image: "" };
  let preview = empty;
  const target = publicFetchUrl(destination);
  try {
    if (!target) throw new Error("blocked");
    const res = await fetch(target.toString(), {
      headers: { "user-agent": "Mozilla/5.0 (compatible; LinkPreview/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) {
      const html = (await res.text()).slice(0, 200_000);
      preview = {
        title: pick(html, [
          /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
          /<title[^>]*>([^<]+)<\/title>/i,
        ]),
        description: pick(html, [
          /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
        ]),
        image: pick(html, [
          /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        ]),
      };
    }
  } catch {
    // ignore — fall back to empty
  }
  await env.LINKS_KV.put(key, JSON.stringify(preview), { expirationTtl: 86_400 });
  return preview;
}

export async function invalidateLinkPreview(env: AppBindings, linkId: string) {
  await env.LINKS_KV.delete(`linkog:${linkId}`);
}

export interface UrlMeta {
  title: string;
  description: string;
  image: string;
  siteName: string;
  favicon: string;
  domain: string;
}

function absolutize(href: string, base: URL): string {
  if (!href) return "";
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

function pickFavicon(html: string): string {
  const tag = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i.exec(html);
  if (!tag) return "";
  return /href=["']([^"']+)["']/i.exec(tag[0])?.[1] ?? "";
}

function emptyMeta(rawUrl: string): UrlMeta {
  let domain = "";
  try {
    domain = new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    /* keep empty */
  }
  return {
    title: "",
    description: "",
    image: "",
    siteName: domain,
    favicon: domain ? `https://${domain}/favicon.ico` : "",
    domain,
  };
}

/**
 * Fetch a destination URL's own metadata (title / description / og:image /
 * site name / favicon) for the rich link-preview card. Cached in KV by URL for
 * a day. Same fetch surface as `destinationPreview`, keyed by URL not link id.
 */
export async function fetchMeta(env: AppBindings, rawUrl: string): Promise<UrlMeta> {
  const u = publicFetchUrl(rawUrl);
  if (!u) return emptyMeta(rawUrl);
  // `v2` bumps the cache namespace so entries scraped before HTML-entity
  // decoding (which would still show "&#064;" etc.) are skipped, not re-served.
  const key = `meta:v2:${u.host}${u.pathname}`.slice(0, 480);
  const cached = await env.LINKS_KV.get<UrlMeta>(key, "json");
  if (cached) return cached;

  let meta = emptyMeta(rawUrl);
  try {
    const res = await fetch(u.toString(), {
      headers: { "user-agent": "Mozilla/5.0 (compatible; LinkPreview/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) {
      const html = (await res.text()).slice(0, 200_000);
      const fav = decodeEntities(pickFavicon(html));
      meta = {
        title: pick(html, [
          /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
          /<title[^>]*>([^<]+)<\/title>/i,
        ]),
        description: pick(html, [
          /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
          /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
        ]),
        image: absolutize(
          pick(html, [
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
          ]),
          u,
        ),
        siteName:
          pick(html, [
            /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
          ]) || u.hostname.replace(/^www\./, ""),
        favicon: fav ? absolutize(fav, u) : `${u.origin}/favicon.ico`,
        domain: u.hostname.replace(/^www\./, ""),
      };
      if (!meta.title) meta.title = meta.domain;
    }
  } catch {
    // ignore — fall back to the domain-only meta
  }
  await env.LINKS_KV.put(key, JSON.stringify(meta), { expirationTtl: 86_400 });
  return meta;
}
