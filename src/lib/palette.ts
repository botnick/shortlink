function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const toHex = (n: number) => n.toString(16).padStart(2, "0");

/**
 * Extract up to `count` representative, dark-enough colors from an image,
 * entirely client-side (downscale → quantize → frequency sort). Near-white
 * colors are dropped since they make poor QR foregrounds.
 */
export async function extractPalette(src: string, count = 8): Promise<string[]> {
  const img = await loadImage(src);
  const size = 72;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const buckets = new Map<number, { c: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = buckets.get(key);
    if (e) {
      e.c++;
      e.r += r;
      e.g += g;
      e.b += b;
    } else {
      buckets.set(key, { c: 1, r, g, b });
    }
  }

  const out: string[] = [];
  const accepted: Array<[number, number, number]> = [];
  const MIN_DIST_SQ = 52 * 52; // drop near-identical / too-similar tones
  for (const e of [...buckets.values()].sort((a, b) => b.c - a.c)) {
    const r = Math.round(e.r / e.c);
    const g = Math.round(e.g / e.c);
    const b = Math.round(e.b / e.c);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum > 215) continue; // too light for a QR foreground
    const tooClose = accepted.some(
      ([ar, ag, ab]) =>
        (ar - r) ** 2 + (ag - g) ** 2 + (ab - b) ** 2 < MIN_DIST_SQ,
    );
    if (tooClose) continue;
    accepted.push([r, g, b]);
    out.push(`#${toHex(r)}${toHex(g)}${toHex(b)}`);
    if (out.length >= count) break;
  }
  return out;
}
