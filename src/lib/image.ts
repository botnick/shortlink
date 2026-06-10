/**
 * Downscale and re-encode an uploaded image entirely in the browser so what we
 * store (and POST as a data URL) stays small and predictable.
 *
 * Outputs WebP — it keeps transparency (so logos stay clean) and compresses
 * photos far better than PNG — falling back to PNG where WebP encoding isn't
 * supported. SVGs are already vector and tiny, so they pass through untouched.
 */
export async function compressImage(
  file: File,
  maxDim = 1200,
  quality = 0.85,
): Promise<string> {
  if (file.type === "image/svg+xml") return readAsDataUrl(file);

  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close?.();
    return readAsDataUrl(file);
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  const webp = canvas.toDataURL("image/webp", quality);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
