// Unambiguous base-56 alphabet (no 0/O/1/l/I) for readable random slugs.
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const DEFAULT_LENGTH = 7;

/** Paths the Worker handles itself — never usable as a custom slug. */
export const RESERVED_SLUGS = new Set([
  "api",
  "app",
  "login",
  "register",
  "logout",
  "admin",
  "dashboard",
  "domains",
  "settings",
  "setup",
  "terms",
  "privacy",
  "links",
  "assets",
  "static",
  "health",
  "icon",
  "og",
  "ogimg",
  "qr",
  "favicon.ico",
  "robots.txt",
  "s",
  "www",
]);

const SLUG_RE = /^[a-zA-Z0-9_-]{3,32}$/;

export function generateSlug(length = DEFAULT_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function isValidCustomSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug.toLowerCase());
}

/** A request path that the Worker must serve from assets, not treat as a slug. */
export function isReservedPath(path: string): boolean {
  return RESERVED_SLUGS.has(path.toLowerCase()) || path.includes(".");
}
