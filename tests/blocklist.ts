/**
 * Unit tests for the destination blocklist matcher (worker/lib/settings.ts
 * isBlockedDestination). Run: `npx tsx tests/blocklist.ts` (pure function, no DB).
 *
 * Covers the normalization fixes: a trailing FQDN dot, and IDN — where the
 * destination host is punycode-encoded by new URL() but a Unicode blocklist
 * entry must still match (and vice versa) — plus wildcard/subdomain behavior.
 */
import { isBlockedDestination } from "../worker/lib/settings";

let pass = 0;
let fail = 0;
function check(label: string, got: boolean, exp: boolean) {
  if (got === exp) {
    pass++;
    console.log("  ✓", label);
  } else {
    fail++;
    console.log("  ✗", label, `→ got ${got}, expected ${exp}`);
  }
}

const blocked = ["evil.com", "*.bad.example", "phish.net."];

check("exact host blocked", isBlockedDestination("https://evil.com/x", blocked), true);
check("subdomain of exact blocked", isBlockedDestination("https://a.evil.com/x", blocked), true);
check("trailing-dot FQDN bypass closed", isBlockedDestination("https://evil.com./x", blocked), true);
check("trailing-dot on subdomain closed", isBlockedDestination("https://a.evil.com./x", blocked), true);
check("wildcard entry matches subdomain", isBlockedDestination("https://x.bad.example/y", blocked), true);
check("wildcard entry matches apex", isBlockedDestination("https://bad.example/y", blocked), true);
check("blocklist entry with trailing dot still matches", isBlockedDestination("https://phish.net/z", blocked), true);
check("unrelated host allowed", isBlockedDestination("https://good.com/x", blocked), false);
check("lookalike suffix not over-matched", isBlockedDestination("https://notevil.com/x", blocked), false);
check("empty blocklist allows all", isBlockedDestination("https://evil.com/x", []), false);
check("malformed url is not blocked (fails safe to caller)", isBlockedDestination("not a url", blocked), false);

// IDN: a Unicode blocklist entry must match a real Unicode destination. new URL()
// punycode-encodes the destination host, so the matcher has to punycode the entry
// too. Build the punycode form via new URL() rather than hardcoding it.
const unicodeHost = "пример.example";
const punycodeHost = new URL(`https://${unicodeHost}`).hostname; // e.g. xn--e1afmkfd.example
check("IDN: unicode entry vs unicode destination", isBlockedDestination(`https://${unicodeHost}/x`, [unicodeHost]), true);
check("IDN: unicode entry vs punycode destination", isBlockedDestination(`https://${punycodeHost}/x`, [unicodeHost]), true);
check("IDN: punycode entry vs unicode destination", isBlockedDestination(`https://${unicodeHost}/x`, [punycodeHost]), true);
check("IDN: subdomain of unicode entry", isBlockedDestination(`https://a.${unicodeHost}/x`, [unicodeHost]), true);
check("IDN: unrelated unicode host allowed", isBlockedDestination("https://другой.example/x", [unicodeHost]), false);

console.log(`\nblocklist: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
