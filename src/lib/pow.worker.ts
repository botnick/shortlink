/**
 * Proof-of-work solver, off the main thread. Runs a tight synchronous hashing
 * loop (no per-hash Promise/microtask overhead) and posts back the first nonce
 * whose SHA-256(challenge + "." + nonce) has the required leading zero bits.
 * The parent aborts by calling worker.terminate().
 *
 * Cost note: this is the ONLY heavy compute in the whole human check, and it
 * runs in the visitor's browser — the server never pays for it. That's what
 * keeps the deployment inside a serverless free tier.
 */
import { sha256, leadingZeroBits } from "./sha256";

self.onmessage = (e: MessageEvent<{ challenge: string; bits: number }>) => {
  const { challenge, bits } = e.data;
  if (bits <= 0) {
    (self as unknown as Worker).postMessage("");
    return;
  }
  const enc = new TextEncoder();
  const prefix = enc.encode(`${challenge}.`); // ref is hex + "." → all ASCII
  const buf = new Uint8Array(prefix.length + 16);
  buf.set(prefix);
  // Random start so two tabs / a retry don't redo identical work.
  let counter = Math.floor(Math.random() * 0xffffffff) >>> 0;
  for (;;) {
    const sol = counter.toString(36); // base36 → ASCII bytes
    let n = prefix.length;
    for (let i = 0; i < sol.length; i++) buf[n++] = sol.charCodeAt(i);
    if (leadingZeroBits(sha256(buf.subarray(0, n))) >= bits) {
      (self as unknown as Worker).postMessage(sol);
      return;
    }
    counter = (counter + 1) >>> 0;
  }
};
