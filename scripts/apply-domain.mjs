// Makes custom domains "set one env var" — no wrangler.jsonc editing, so an
// open-source deploy is configured entirely from the environment.
//
// Resolves APP_URL with this precedence, then writes it into the built config's
// vars (so the deployed Worker gets it at runtime) and derives the Worker's route
// from its host:
//   1. process.env.APP_URL      — Workers Builds "Variables", or `export APP_URL=…`
//   2. APP_URL in ./.dev.vars   — local deploys
//   3. vars.APP_URL in wrangler.jsonc — the shipped default (a *.workers.dev URL)
//
//   host is *.workers.dev   → no custom route (served on the workers.dev subdomain)
//   host is your own domain → routes:[{ pattern: host, custom_domain: true }]
//                             (Cloudflare manages its DNS + TLS automatically)
//
// Runs after build, before `wrangler deploy` (see the `deploy` script); also runs
// in Workers Builds, which calls the same script. The custom domain's zone must be
// on the same Cloudflare account as the Worker — see docs/CUSTOM-DOMAINS.md.
import { readFileSync, writeFileSync } from "node:fs";

const path = "dist/shortlink/wrangler.json";
let cfg;
try {
  cfg = JSON.parse(readFileSync(path, "utf8"));
} catch {
  console.error(`[apply-domain] ${path} not found — run \`npm run build\` first.`);
  process.exit(1);
}

// Minimal .dev.vars reader (KEY=value / KEY="value", ignores comments/blanks).
function fromDevVars(key) {
  let text;
  try {
    text = readFileSync(".dev.vars", "utf8");
  } catch {
    return undefined;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "").trim();
  }
  return undefined;
}

cfg.vars = cfg.vars ?? {};
const appUrl =
  process.env.APP_URL || fromDevVars("APP_URL") || cfg.vars.APP_URL;
if (!appUrl) {
  console.log("[apply-domain] no APP_URL (env, .dev.vars, or config) — leaving routes as-is.");
  process.exit(0);
}
// Persist the resolved value so the deployed Worker has it as a runtime var
// (otherwise `wrangler deploy` would ship the stale wrangler.jsonc default).
cfg.vars.APP_URL = appUrl;

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
