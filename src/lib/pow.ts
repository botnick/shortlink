/**
 * Browser side of the sign-up proof-of-work: silently find a nonce whose
 * SHA-256(challenge + "." + nonce) has the required leading zero bits.
 * Humans never interact with this — it runs while they type. Hashing happens
 * in parallel batches so a typical solve lands well under a second or two.
 */
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

export async function solvePow(
  challenge: string,
  bits: number,
  signal?: AbortSignal,
): Promise<string> {
  const enc = new TextEncoder();
  const BATCH = 256;
  // Random start so parallel tabs don't redo identical work.
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
