/**
 * CSPRNG-backed randomness for challenge generation. Math.random() is avoided
 * everywhere in the human check on purpose: layouts, rules and decoys must be
 * unpredictable even to an attacker who has observed many challenges.
 */

const POOL_SIZE = 256;
let pool = new Uint32Array(0);
let poolIdx = 0;

function nextUint32(): number {
  if (poolIdx >= pool.length) {
    pool = crypto.getRandomValues(new Uint32Array(POOL_SIZE));
    poolIdx = 0;
  }
  return pool[poolIdx++];
}

/** Uniform integer in [min, max] (inclusive), rejection-sampled (no modulo bias). */
export function randInt(min: number, max: number): number {
  const range = max - min + 1;
  if (range <= 1) return min;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  let v = nextUint32();
  while (v >= limit) v = nextUint32();
  return min + (v % range);
}

/** Uniform float in [min, max). */
export function randFloat(min: number, max: number): number {
  return min + (nextUint32() / 0x1_0000_0000) * (max - min);
}

export function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

/** Fisher–Yates over a copy. */
export function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Short random id for scene objects (8 hex chars — display-scoped, not secret). */
export function sceneId(): string {
  return nextUint32().toString(16).padStart(8, "0");
}
