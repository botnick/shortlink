/**
 * Unit tests for the redirect routing precedence (worker/lib/cache.ts
 * routeDestination). Run: `npx tsx tests/routing.ts` (pure function, no DB).
 *
 * Precedence: matching per-country rule > per-OS deep link > destination.
 */
import { routeDestination, type CachedLink } from "../worker/lib/cache";

let pass = 0;
let fail = 0;
function check(label: string, got: string, exp: string) {
  if (got === exp) {
    pass++;
    console.log("  ✓", label);
  } else {
    fail++;
    console.log("  ✗", label, `→ got "${got}", expected "${exp}"`);
  }
}

const base: CachedLink = {
  id: "1",
  destination: "https://dest",
  iosUrl: "https://ios",
  androidUrl: null,
  desktopUrl: "https://desktop",
  geoRules: [
    { country: "TH", url: "https://thai" },
    { country: "US", url: "https://usa" },
  ],
  isActive: true,
  hasPassword: false,
  expiresAt: null,
};

// Country wins over OS / device.
check("TH (lowercase) beats iOS", routeDestination(base, "th", "iOS", null), "https://thai");
check("US beats iOS + desktop", routeDestination(base, "US", "iOS", "desktop"), "https://usa");
// No country rule → fall through to OS, then device, then destination.
check("JP has no rule → iOS", routeDestination(base, "JP", "iOS", null), "https://ios");
check("no country → desktop", routeDestination(base, null, null, "desktop"), "https://desktop");
check("Android unset → destination", routeDestination(base, "JP", "Android", null), "https://dest");
// Unknown / Tor / missing country codes never match a rule.
check("XX unknown → destination", routeDestination(base, "XX", null, null), "https://dest");
check("T1 (Tor) → destination", routeDestination(base, "T1", null, null), "https://dest");

// Legacy links cached before geo routing shipped (geoRules absent / null).
const legacy: CachedLink = {
  id: "2",
  destination: "https://legacy",
  iosUrl: null,
  androidUrl: null,
  desktopUrl: null,
  isActive: true,
  hasPassword: false,
  expiresAt: null,
};
check("legacy (no geoRules) → destination, no crash", routeDestination(legacy, "TH", "iOS", null), "https://legacy");
check("empty geoRules → destination", routeDestination({ ...legacy, geoRules: [] }, "TH", null, null), "https://legacy");

console.log(`\nrouting: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
