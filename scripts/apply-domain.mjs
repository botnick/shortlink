// Makes custom domains "set one value". Derives the Workers route from APP_URL's
// host at deploy time, so APP_URL is the ONLY thing you edit to change domains —
// you never touch a `routes` block. Runs after build, before `wrangler deploy`
// (see the `deploy` script); also runs in Workers Builds, which calls the same script.
//
//   APP_URL host is *.workers.dev  → no custom route (served on the workers.dev subdomain)
//   APP_URL host is your own domain → routes:[{ pattern: host, custom_domain: true }]
//                                     (Cloudflare manages its DNS + TLS automatically)
//
// The custom domain's zone must be on the same Cloudflare account as the Worker —
// see docs/CUSTOM-DOMAINS.md. APP_URL is the single source of truth, so whatever
// route this derives overwrites any existing one in the built config.
import { readFileSync, writeFileSync } from "node:fs";

const path = "dist/shortlink/wrangler.json";
let cfg;
try {
  cfg = JSON.parse(readFileSync(path, "utf8"));
} catch {
  console.error(`[apply-domain] ${path} not found — run \`npm run build\` first.`);
  process.exit(1);
}

const appUrl = cfg.vars?.APP_URL;
if (!appUrl) {
  console.log("[apply-domain] no APP_URL set — leaving routes as-is.");
  process.exit(0);
}

let host;
try {
  host = new URL(appUrl).host;
} catch {
  console.error(`[apply-domain] APP_URL is not a valid URL: "${appUrl}"`);
  process.exit(1);
}

if (host.endsWith(".workers.dev")) {
  delete cfg.routes; // served on the *.workers.dev subdomain — no custom domain
  console.log(`[apply-domain] APP_URL on workers.dev (${host}) — no custom domain route.`);
} else {
  cfg.routes = [{ pattern: host, custom_domain: true }];
  console.log(`[apply-domain] custom domain → ${host} (custom_domain route added).`);
}

writeFileSync(path, JSON.stringify(cfg, null, 2));
