// Dev-only: render every OG template to a PNG contact sheet via @napi-rs/canvas
// (Skia — matches Chrome's canvas closely) so designs can be reviewed without a
// browser. Run: npx tsx scripts/og-preview.ts  → writes _og-preview.png
import { createCanvas, GlobalFonts, type Canvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { OG_TEMPLATES, renderOg, OG_W, OG_H } from "../src/lib/ogTemplates";

const FONTS: [string, string, number][] = [
  ["public/og-fonts/ibm-plex-thai-400.woff2", "IBMPlexThaiOG", 400],
  ["public/og-fonts/ibm-plex-thai-700.woff2", "IBMPlexThaiOG", 700],
  ["public/og-fonts/kanit-400.woff2", "KanitOG", 400],
  ["public/og-fonts/kanit-700.woff2", "KanitOG", 700],
  ["public/og-fonts/sarabun-400.woff2", "SarabunOG", 400],
  ["public/og-fonts/sarabun-700.woff2", "SarabunOG", 700],
  ["public/og-fonts/noto-sans-thai-400.woff2", "NotoSansThaiOG", 400],
  ["public/og-fonts/noto-sans-thai-700.woff2", "NotoSansThaiOG", 700],
];
for (const [path, family] of FONTS) {
  const ok = GlobalFonts.registerFromPath(path, family);
  if (!ok) console.warn("font register failed:", path);
}

const SAMPLE = {
  font: "IBMPlexThaiOG",
  title: "ย่อลิงก์ให้สั้น แชร์สวยติดแบรนด์ในคลิกเดียว",
  description: "เร็ว ฟรี รองรับการใช้งานจริงบน edge — Shorten links beautifully.",
  appName: "shortlink",
  brandColor: "#e5392e",
  url: "go.brand.co/launch",
};

// contact sheet
const cols = 2;
const cellW = 600;
const cellH = 315;
const labelH = 30;
const gap = 16;
const rows = Math.ceil(OG_TEMPLATES.length / cols);
const sheet = createCanvas(
  cols * cellW + (cols + 1) * gap,
  rows * (cellH + labelH) + (rows + 1) * gap,
);
const sctx = sheet.getContext("2d");
sctx.fillStyle = "#3f3f46";
sctx.fillRect(0, 0, sheet.width, sheet.height);

OG_TEMPLATES.forEach((t, i) => {
  const card = createCanvas(OG_W, OG_H) as unknown as HTMLCanvasElement;
  renderOg(card, { template: t.id, ...SAMPLE });
  const col = i % cols;
  const row = Math.floor(i / cols);
  const x = gap + col * (cellW + gap);
  const y = gap + row * (cellH + labelH + gap);
  sctx.drawImage(card as unknown as Canvas, x, y, cellW, cellH);
  sctx.fillStyle = "#fff";
  sctx.font = "600 18px sans-serif";
  sctx.fillText(`${t.id} — ${t.label}`, x + 4, y + cellH + 21);
});

writeFileSync("_og-preview.png", sheet.toBuffer("image/png"));

// Also dump a few full-size cards for close inspection.
import { mkdirSync } from "node:fs";
mkdirSync("_og", { recursive: true });
for (const t of OG_TEMPLATES) {
  const card = createCanvas(OG_W, OG_H) as unknown as HTMLCanvasElement;
  renderOg(card, { template: t.id, ...SAMPLE });
  writeFileSync(`_og/${t.id}.png`, (card as unknown as Canvas).toBuffer("image/png"));
}
console.log(`wrote _og-preview.png + _og/*.png (${OG_TEMPLATES.length} templates)`);
