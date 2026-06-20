import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "../env";

const prodHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    fontSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: [],
  },
  strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  referrerPolicy: "strict-origin-when-cross-origin",
  crossOriginOpenerPolicy: "same-origin",
  crossOriginResourcePolicy: "same-origin",
  permissionsPolicy: {
    geolocation: [],
    camera: [],
    microphone: [],
  },
});

// Dev (http) keeps it light so Vite HMR / Fast Refresh isn't blocked by CSP.
const devHeaders = secureHeaders({
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  referrerPolicy: "strict-origin-when-cross-origin",
});

// Public, embeddable assets: the brand favicon/OG image and per-link OG previews
// exist precisely to be loaded BY OTHER ORIGINS — social-card scrapers (Facebook,
// X, LINE, Slack, metatags.io), an <img> on any site, the browser fetching the
// favicon. The global `Cross-Origin-Resource-Policy: same-origin` blocks exactly
// that (browser/scraper reports ERR_BLOCKED_BY_RESPONSE.NotSameOrigin and the OG
// preview shows nothing). These paths serve only public, non-sensitive imagery,
// so they opt down to a cross-origin CORP + permissive CORS for the image bytes.
function isPublicEmbeddableAsset(path: string): boolean {
  return (
    path === "/og" ||
    path === "/icon" ||
    path.startsWith("/ogimg/") ||
    path.startsWith("/brand/") ||
    path.startsWith("/qr/")
  );
}

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  const isHttps = new URL(c.req.url).protocol === "https:";
  await (isHttps ? prodHeaders : devHeaders)(c, next);
  if (isPublicEmbeddableAsset(c.req.path)) {
    c.res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    c.res.headers.set("Access-Control-Allow-Origin", "*");
  }
});

/**
 * Defense-in-depth on top of Hono's `csrf()` (which only inspects form content
 * types): for unsafe methods, reject any request whose Origin header doesn't
 * match this origin. Missing Origin is allowed so non-browser API clients still
 * work — browsers always send Origin on state-changing requests.
 */
export const requireSameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  const unsafe = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (unsafe) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: "Cross-origin request blocked" }, 403);
    }
  }
  await next();
});
