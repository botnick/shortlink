// Dev-only: render every worker-served brand page to standalone HTML files so
// the design can be reviewed in a browser. Copy comes from DEFAULT_BRAND_COPY
// (the same defaults an unconfigured install serves).
// Run: npx tsx scripts/brand-pages-preview.ts  → writes _brand-pages/*.html
import { mkdirSync, writeFileSync } from "node:fs";
import {
  interstitialHtml,
  linkErrorHtml,
  passwordPageHtml,
  type BrandBits,
} from "../shared/brandPages";
import { DEFAULT_BRAND_COPY } from "../shared/defaults";

const COPY = DEFAULT_BRAND_COPY;
const BRANDS: Record<string, BrandBits> = {
  default: { appName: "Shortlink", brandColor: "#e5392e", logoUrl: "" },
  branded: { appName: "Tomato", brandColor: "#1d4ed8", logoUrl: "" },
};

mkdirSync("_brand-pages", { recursive: true });
for (const [name, cfg] of Object.entries(BRANDS)) {
  writeFileSync(`_brand-pages/${name}-404.html`, linkErrorHtml(cfg, COPY, "not-found"));
  writeFileSync(`_brand-pages/${name}-expired.html`, linkErrorHtml(cfg, COPY, "expired"));
  writeFileSync(`_brand-pages/${name}-disabled.html`, linkErrorHtml(cfg, COPY, "disabled"));
  writeFileSync(`_brand-pages/${name}-rate-limited.html`, linkErrorHtml(cfg, COPY, "rate-limited"));
  writeFileSync(`_brand-pages/${name}-error.html`, linkErrorHtml(cfg, COPY, "error"));
  writeFileSync(`_brand-pages/${name}-password.html`, passwordPageHtml(cfg, COPY, "demo"));
  writeFileSync(
    `_brand-pages/${name}-password-error.html`,
    passwordPageHtml(cfg, COPY, "demo", "Incorrect password. Try again."),
  );
  writeFileSync(
    `_brand-pages/${name}-interstitial.html`,
    interstitialHtml(cfg, COPY, "demo", "example.com"),
  );
}
console.log("wrote _brand-pages/*.html — open in a browser to review");
