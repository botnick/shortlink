/**
 * Unit tests for the peppered password hashing (worker/lib/password.ts).
 * Run: `npx tsx tests/password.ts` (no DB, no bindings — pure crypto).
 */
import { hashPassword, needsRehash, verifyPassword } from "../worker/lib/password";
import { bytesToHex } from "../worker/lib/encoding";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  ✓", label);
  } else {
    fail++;
    console.log("  ✗", label);
  }
}

/** Build a LEGACY (pre-pepper) hash exactly as the old code did: PBKDF2 over the
 *  raw password, no pepper. Low iteration count just to keep the test fast. */
async function legacyHash(password: string, iterations = 50_000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    km,
    256,
  );
  return `pbkdf2-sha256$${iterations}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}

(async () => {
  const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
  const OTHER = "a-totally-different-secret-zzzzzzzzzzzzzzzzzz";

  // --- peppered scheme ---
  const stored = await hashPassword("correct horse battery", SECRET);
  check("hash uses the peppered scheme prefix", stored.startsWith("pbkdf2p1$"));
  check("correct password + secret verifies", await verifyPassword("correct horse battery", stored, SECRET));
  check("wrong password fails", !(await verifyPassword("wrong horse", stored, SECRET)));
  check(
    "wrong secret fails — the pepper binds the hash to SESSION_SECRET",
    !(await verifyPassword("correct horse battery", stored, OTHER)),
  );

  // distinct salts per call (non-deterministic)
  const stored2 = await hashPassword("correct horse battery", SECRET);
  check("same password hashes to a different value (random salt)", stored !== stored2);

  // --- tamper resistance ---
  const p = stored.split("$");
  check(
    "tampered key fails",
    !(await verifyPassword("correct horse battery", `${p[0]}$${p[1]}$${p[2]}$${"0".repeat(p[3].length)}`, SECRET)),
  );
  check(
    "tampered salt fails",
    !(await verifyPassword("correct horse battery", `${p[0]}$${p[1]}$${"0".repeat(p[2].length)}$${p[3]}`, SECRET)),
  );
  check("malformed hash fails", !(await verifyPassword("x", "not-a-hash", SECRET)));

  // --- legacy back-compat (unpeppered, secret ignored) ---
  const legacy = await legacyHash("legacy password");
  check("legacy pbkdf2-sha256 hash still verifies", await verifyPassword("legacy password", legacy, SECRET));
  check("legacy wrong password fails", !(await verifyPassword("nope", legacy, SECRET)));

  // --- needsRehash ---
  check("needsRehash: true for a legacy hash", needsRehash(legacy));
  check("needsRehash: false for a current peppered hash", !needsRehash(stored));
  check(
    "needsRehash: true for a different iteration count",
    needsRehash(stored.replace(/^pbkdf2p1\$\d+\$/, "pbkdf2p1$999999$")),
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
})();
