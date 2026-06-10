/** Correctness + speed check for the synchronous SHA-256 used by the PoW worker. */
import { sha256, leadingZeroBits } from "../src/lib/sha256";

const hex = (b: Uint8Array) =>
  Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
const enc = new TextEncoder();

let ok = true;
const vec: [string, string][] = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "The quick brown fox jumps over the lazy dog",
    "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
  ],
];
for (const [msg, want] of vec) {
  const got = hex(sha256(enc.encode(msg)));
  const pass = got === want;
  ok = ok && pass;
  console.log(`  ${pass ? "✓" : "✗"} sha256(${JSON.stringify(msg).slice(0, 24)}) ${pass ? "" : `\n     got  ${got}\n     want ${want}`}`);
}

// Cross-check 256 random inputs against Node's WebCrypto.
let cross = true;
for (let i = 0; i < 256; i++) {
  const data = enc.encode(`probe-${i}-${Math.random()}`);
  const mine = hex(sha256(data));
  const ref = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
  if (mine !== ref) { cross = false; console.log(`  ✗ mismatch on input ${i}`); break; }
}
console.log(`  ${cross ? "✓" : "✗"} matches WebCrypto on 256 random inputs`);
ok = ok && cross;

// Speed: how fast can we find an N-bit PoW solution synchronously?
for (const bits of [16, 19]) {
  const challenge = "hc1_" + "a".repeat(64);
  const prefix = enc.encode(`${challenge}.`);
  const buf = new Uint8Array(prefix.length + 16);
  buf.set(prefix);
  const t0 = performance.now();
  let counter = 0, hashes = 0;
  for (;;) {
    const sol = counter.toString(36);
    let n = prefix.length;
    for (let j = 0; j < sol.length; j++) buf[n++] = sol.charCodeAt(j);
    hashes++;
    if (leadingZeroBits(sha256(buf.subarray(0, n))) >= bits) break;
    counter++;
  }
  const ms = performance.now() - t0;
  console.log(`  ⏱  ${bits}-bit solved in ${Math.round(ms)} ms (${hashes} hashes, ${Math.round(hashes / ms)} kH/s)`);
}

console.log(`\n=== ${ok ? "PASS" : "FAIL"} ===`);
process.exit(ok ? 0 : 1);
