/**
 * Browser side of the sign-up proof-of-work: silently find a nonce whose
 * SHA-256(challenge + "." + nonce) has the required leading zero bits. Humans
 * never interact with this — it runs while they play/type.
 *
 * It runs in a Web Worker with a synchronous hashing loop: at this volume the
 * per-call Promise overhead of `crypto.subtle.digest` dominates, so a tight
 * sync loop is far faster AND the main thread never janks. A subtle.digest
 * fallback covers any environment without module workers (SSR, old browsers).
 */
export function solvePow(
  challenge: string,
  bits: number,
  signal?: AbortSignal,
): Promise<string> {
  if (bits <= 0) return Promise.resolve("");
  if (typeof Worker !== "undefined" && typeof URL !== "undefined") {
    return new Promise<string>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL("./pow.worker.ts", import.meta.url), {
          type: "module",
        });
      } catch {
        solvePowAsync(challenge, bits, signal).then(resolve, reject);
        return;
      }
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        worker.terminate();
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      worker.onmessage = (e: MessageEvent<string>) => {
        cleanup();
        resolve(e.data);
      };
      worker.onerror = () => {
        cleanup();
        // Worker failed to load (e.g. CSP) → solve on the main thread instead.
        solvePowAsync(challenge, bits, signal).then(resolve, reject);
      };
      worker.postMessage({ challenge, bits });
    });
  }
  return solvePowAsync(challenge, bits, signal);
}

function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    let b = byte;
    while ((b & 0x80) === 0) {
      bits++;
      b <<= 1;
    }
    break;
  }
  return bits;
}

/** Fallback solver using the async Web Crypto API (no Web Worker required). */
async function solvePowAsync(
  challenge: string,
  bits: number,
  signal?: AbortSignal,
): Promise<string> {
  if (bits <= 0) return "";
  const enc = new TextEncoder();
  const BATCH = 256;
  let counter = Math.floor(Math.random() * 0xffffff);
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const results = await Promise.all(
      Array.from({ length: BATCH }, (_, i) => {
        const sol = (counter + i).toString(36);
        return crypto.subtle
          .digest("SHA-256", enc.encode(`${challenge}.${sol}`))
          .then((d) => ({ sol, digest: new Uint8Array(d) }));
      }),
    );
    for (const r of results) {
      if (leadingZeroBits(r.digest) >= bits) return r.sol;
    }
    counter += BATCH;
  }
}
