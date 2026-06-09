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
 *  real browser that somehow lands here still continues to the destination. */
export function previewHtml(p: Preview, destination: string, siteName: string): string {
  const title = p.title;
  const m: string[] = [
    `<meta name="robots" content="noindex">`,
    `<title>${esc(title)}</title>`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(siteName)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:url" content="${esc(destination)}">`,
    `<meta property="og:locale" content="en_US">`,
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

function pick(html: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return m[1].trim().slice(0, 300);
  }
  return "";
}

/** Fetch the destination's own OG tags (cached in KV per link for a day). */
export async function destinationPreview(
  env: AppBindings,
  linkId: string,
  destination: string,
): Promise<Preview> {
  const key = `linkog:${linkId}`;
  const cached = await env.LINKS_KV.get<Preview>(key, "json");
  if (cached) return cached;

  const empty: Preview = { title: "", description: "", image: "" };
  let preview = empty;
  try {
    const res = await fetch(destination, {
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
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return emptyMeta(rawUrl);
  }
  const key = `meta:${u.host}${u.pathname}`.slice(0, 480);
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
      const fav = pickFavicon(html);
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
