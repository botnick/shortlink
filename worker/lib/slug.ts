// Unambiguous base-56 alphabet (no 0/O/1/l/I) for readable random slugs.
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
// Fallback only — the actual length is the admin setting `slugLength`
// (see slugLengthFrom), passed in by callers that have settings loaded.
const DEFAULT_LENGTH = 6;

// Slugs that must never be claimed — anything that collides with a route, leaks
// authority, or invites phishing. Kept deliberately broad. Grouped for review.
const RESERVED_LIST = [
  // --- App routes / worker paths (real collisions) ---
  "api", "app", "apps", "admin", "administrator", "dashboard", "login", "logout",
  "signin", "sign-in", "signout", "sign-out", "signup", "sign-up", "register",
  "auth", "oauth", "sso", "saml", "callback", "account", "accounts", "profile",
  "user", "users", "me", "settings", "setup", "preferences", "config", "console",
  "home", "index", "public", "private", "internal", "system", "root", "null",

  // --- Product features / actions ---
  "links", "link", "redirect", "go", "out", "click", "clicks", "track", "tracking",
  "analytics", "stats", "statistics", "report", "reports", "qr", "qrcode", "embed",
  "widget", "preview", "unlock", "new", "edit", "create", "add", "delete", "remove",
  "update", "search", "explore", "browse", "list", "view", "share", "copy", "open",

  // --- Content / legal / commerce ---
  "terms", "tos", "privacy", "policy", "policies", "legal", "dmca", "gdpr", "ccpa",
  "cookie", "cookies", "security", "abuse", "spam", "phishing", "contact", "about",
  "help", "support", "faq", "docs", "doc", "documentation", "guide", "guides",
  "blog", "news", "press", "status", "changelog", "pricing", "plans", "plan",
  "billing", "invoice", "invoices", "subscribe", "subscription", "upgrade",
  "checkout", "pay", "payment", "payments", "order", "orders", "cart", "refund",

  // --- Team / org ---
  "team", "teams", "org", "orgs", "organization", "organizations", "workspace",
  "workspaces", "project", "projects", "group", "groups", "member", "members",
  "invite", "invites", "invitation",

  // --- Infra / well-known / files ---
  "assets", "asset", "static", "cdn", "media", "files", "file", "download",
  "downloads", "upload", "uploads", "img", "image", "images", "icon", "icons",
  "og", "ogimg", "brand", "favicon", "fonts", "font", "css", "js", "scripts", "style",
  "styles", "robots", "sitemap", "manifest", "sw", "service-worker", "ads",
  "humans", "well-known", ".well-known", "acme-challenge", "s", "www", "ftp",
  "mail", "email", "smtp", "imap", "pop", "ns", "mx", "dns", "ws", "wss", "ssh",
  "graphql", "rest", "webhook", "webhooks", "v1", "v2", "v3", "api-docs", "swagger", "mcp",
  "openapi", "health", "healthz", "ping", "metrics", "debug", "test", "tests",
  "demo", "example", "examples", "sample", "default", "temp", "tmp",
  "favicon.ico", "robots.txt", "sitemap.xml", "ads.txt", "security.txt",
  "humans.txt", "manifest.json", "sw.js",

  // --- Auth / security words ---
  "password", "passwd", "reset", "forgot", "verify", "verification", "confirm",
  "activate", "token", "secret", "secrets", "key", "keys", "apikey", "apikeys", "api-key",
  "2fa", "mfa", "otp", "captcha", "session", "sessions",

  // --- High-risk impersonation brands (phishing) ---
  "google", "gmail", "facebook", "fb", "meta", "instagram", "ig", "whatsapp",
  "messenger", "threads", "twitter", "youtube", "yt", "tiktok", "snapchat",
  "linkedin", "pinterest", "reddit", "discord", "telegram", "line", "wechat",
  "apple", "icloud", "itunes", "appstore", "microsoft", "windows", "outlook",
  "office", "office365", "onedrive", "amazon", "aws", "paypal", "visa",
  "mastercard", "amex", "stripe", "venmo", "cashapp", "wise", "revolut",
  "binance", "coinbase", "crypto", "bitcoin", "metamask", "netflix", "spotify",
  "disney", "steam", "roblox", "github", "gitlab", "dropbox", "slack", "zoom",
  "notion", "figma", "shopify", "ebay", "shopee", "lazada", "grab", "uber",
  "airbnb", "booking", "agoda", "bank", "banking",
  // Thai context (impersonation of local banks / telcos / wallets)
  "kbank", "scb", "bbl", "ktb", "krungsri", "promptpay", "truemoney", "ais",
  "dtac", "truecorp",
];

/** Paths the Worker handles itself or that are too risky to hand out as a custom
 *  slug (route collisions, authority leaks, brand impersonation). */
const RESERVED_SLUGS = new Set(RESERVED_LIST.map((s) => s.toLowerCase()));

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
