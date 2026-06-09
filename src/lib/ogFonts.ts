// Self-hosted OFL Thai/Latin fonts used only for OG-card generation. They're
// loaded on demand (admin/dashboard side) via the FontFace API and the woff2
// files in /public/og-fonts — so they never touch the redirect path or the
// initial SPA bundle. Each family ships a 400 + 700 weight, subset to
// Latin + Thai + punctuation (~20–32KB per weight).

export interface OgFont {
  id: string;
  label: string;
  /** Canvas font-family name — namespaced so it can't clash with app fonts. */
  family: string;
}

export const OG_FONTS: OgFont[] = [
  { id: "ibm-plex-thai", label: "IBM Plex Sans Thai", family: "IBMPlexThaiOG" },
  { id: "ibm-plex-thai-looped", label: "IBM Plex Thai Looped", family: "IBMPlexThaiLoopedOG" },
  { id: "kanit", label: "Kanit", family: "KanitOG" },
  { id: "noto-sans-thai", label: "Noto Sans Thai", family: "NotoSansThaiOG" },
  { id: "sarabun", label: "Sarabun", family: "SarabunOG" },
];

export const OG_FONT_IDS = OG_FONTS.map((f) => f.id);
const DEFAULT_FONT = OG_FONTS[0];
const byId = new Map(OG_FONTS.map((f) => [f.id, f]));
const loaded = new Set<string>();

function resolve(id: string): OgFont {
  return byId.get(id) ?? DEFAULT_FONT;
}

/** Canvas font-family for an id (use after `loadOgFont` so glyphs are ready). */
export function ogFontFamily(id: string): string {
  return resolve(id).family;
}

/**
 * Load a font's 400 + 700 weights into `document.fonts`. Idempotent and cached,
 * so re-rendering the card or switching back to a font is instant. Returns the
 * canvas font-family to draw with.
 */
export async function loadOgFont(id: string): Promise<string> {
  const font = resolve(id);
  if (loaded.has(font.id)) return font.family;
  const base = `/og-fonts/${font.id}`;
  const faces = [
    new FontFace(font.family, `url(${base}-400.woff2)`, { weight: "400" }),
    new FontFace(font.family, `url(${base}-700.woff2)`, { weight: "700" }),
  ];
  await Promise.all(
    faces.map(async (face) => {
      await face.load();
      document.fonts.add(face);
    }),
  );
  loaded.add(font.id);
  return font.family;
}
