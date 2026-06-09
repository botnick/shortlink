// Dev-only: render every worker-served brand page (404 / expired / disabled /
// password prompt) to standalone HTML files so the design can be reviewed in a
// browser. Run: npx tsx scripts/brand-pages-preview.ts  → writes _brand-pages/*.html
import { mkdirSync, writeFileSync } from "node:fs";
import {
  linkErrorHtml,
  passwordPageHtml,
  type BrandBits,
} from "../shared/brandPages";

const BRANDS: Record<string, BrandBits> = {
  default: { appName: "Shortlink", brandColor: "#e5392e", logoUrl: "" },
  branded: { appName: "Tomato", brandColor: "#1d4ed8", logoUrl: "" },
};

mkdirSync("_brand-pages", { recursive: true });
for (const [name, cfg] of Object.entries(BRANDS)) {
  writeFileSync(`_brand-pages/${name}-404.html`, linkErrorHtml(cfg, "not-found"));
  writeFileSync(`_brand-pages/${name}-expired.html`, linkErrorHtml(cfg, "expired"));
  writeFileSync(`_brand-pages/${name}-disabled.html`, linkErrorHtml(cfg, "disabled"));
  writeFileSync(`_brand-pages/${name}-password.html`, passwordPageHtml(cfg, "demo"));
  writeFileSync(
    `_brand-pages/${name}-password-error.html`,
    passwordPageHtml(cfg, "demo", "Incorrect password. Try again."),
  );
}
console.log("wrote _brand-pages/*.html — open in a browser to review");
