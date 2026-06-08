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

export const securityHeaders = createMiddleware<AppEnv>((c, next) => {
  const isHttps = new URL(c.req.url).protocol === "https:";
  return (isHttps ? prodHeaders : devHeaders)(c, next);
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
