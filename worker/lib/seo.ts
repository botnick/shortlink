import { getDb } from "../db";
import type { AppBindings } from "../env";
import {
  appNameFrom,
  brandColorFrom,
  descriptionFrom,
  getAllSettings,
  indexableFrom,
  logoFrom,
  ogImageFrom,
} from "./settings";

const KEY = "seo:v1";

export interface SeoBundle {
  appName: string;
  description: string;
  brandColor: string;
  logo: string; // data URL / http URL / ""
  ogImage: string; // data URL / http URL / ""
  indexable: boolean;
  appUrl: string;
}

/** Cached in KV so the per-request HTML injection rarely touches the DB. */
export async function getSeoBundle(env: AppBindings): Promise<SeoBundle> {
  const cached = await env.LINKS_KV.get<SeoBundle>(KEY, "json");
  if (cached) return cached;

  const db = getDb(env);
  try {
    const map = await getAllSettings(db);
    const bundle: SeoBundle = {
      appName: appNameFrom(map),
      description: descriptionFrom(map),
      brandColor: brandColorFrom(map),
      logo: logoFrom(map),
      ogImage: ogImageFrom(map) || logoFrom(map),
      indexable: indexableFrom(map),
      appUrl: env.APP_URL,
    };
    await env.LINKS_KV.put(KEY, JSON.stringify(bundle), { expirationTtl: 3600 });
    return bundle;
  } finally {
    await db.$client.end({ timeout: 5 }).catch(() => {});
  }
}

export async function invalidateSeo(kv: KVNamespace): Promise<void> {
  await kv.delete(KEY);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Rewrite the SPA shell <head> with the current branding + SEO meta. */
export function injectSeo(html: Response, b: SeoBundle): Response {
  const title = b.appName;
  const desc = b.description || `${b.appName} — a fast, clean URL shortener.`;
  const favicon = b.logo
    ? b.logo.startsWith("http")
      ? b.logo
      : "/icon"
    : "/favicon.svg";
  const hasOg = b.ogImage.length > 0;
  const ogImageUrl = hasOg
    ? b.ogImage.startsWith("http")
      ? b.ogImage
      : `${b.appUrl}/og`
    : "";

  let head = `
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(title)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(b.appUrl)}">
<meta name="twitter:card" content="${hasOg ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">`;
  if (hasOg) {
    head += `\n<meta property="og:image" content="${esc(ogImageUrl)}">\n<meta name="twitter:image" content="${esc(ogImageUrl)}">`;
  }
  if (!b.indexable) {
    head += `\n<meta name="robots" content="noindex,nofollow">`;
  }

  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        el.setAttribute("content", desc);
      },
    })
    .on('meta[name="theme-color"]', {
      element(el) {
        el.setAttribute("content", b.brandColor);
      },
    })
    .on('link[rel="icon"]', {
      element(el) {
        el.setAttribute("href", favicon);
      },
    })
    .on("head", {
      element(el) {
        el.append(head, { html: true });
      },
    })
    .transform(html);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Serve the uploaded favicon (`/icon`) or OG image (`/og`) from settings. */
export async function serveBrandImage(
  env: AppBindings,
  which: "icon" | "og",
): Promise<Response> {
  const b = await getSeoBundle(env);
  const src = which === "og" ? b.ogImage : b.logo;
  if (!src) return new Response("Not found", { status: 404 });
  if (src.startsWith("http")) return Response.redirect(src, 302);

  const m = /^data:([^;]+);base64,(.+)$/.exec(src);
  if (!m) return new Response("Not found", { status: 404 });
  return new Response(base64ToBytes(m[2]), {
    headers: {
      "content-type": m[1],
      "cache-control": "public, max-age=3600",
    },
  });
}

export async function robotsTxt(env: AppBindings): Promise<string> {
  const b = await getSeoBundle(env);
  if (!b.indexable) return "User-agent: *\nDisallow: /\n";
  return "User-agent: *\nDisallow: /api/\nDisallow: /dashboard\nDisallow: /admin\n";
}
