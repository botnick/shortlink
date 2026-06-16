// Pure helpers for the link editor: UTM parsing/merging and back-half ("slug")
// suggestion. Extracted from LinkEditor.tsx so the form logic can be unit-tested
// and the component stays focused on view + state wiring.

// --- UTM helpers ------------------------------------------------------------
export const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Record<UtmKey, string>;
export const EMPTY_UTM: Utm = { source: "", medium: "", campaign: "", term: "", content: "" };

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseUtm(url: string): Utm {
  try {
    const u = new URL(url);
    return {
      source: u.searchParams.get("utm_source") ?? "",
      medium: u.searchParams.get("utm_medium") ?? "",
      campaign: u.searchParams.get("utm_campaign") ?? "",
      term: u.searchParams.get("utm_term") ?? "",
      content: u.searchParams.get("utm_content") ?? "",
    };
  } catch {
    return EMPTY_UTM;
  }
}

export function applyUtm(url: string, utm: Utm): string {
  try {
    const u = new URL(url);
    for (const k of UTM_KEYS) {
      const v = utm[k].trim();
      if (v) u.searchParams.set(`utm_${k}`, v);
      else u.searchParams.delete(`utm_${k}`);
    }
    return u.toString();
  } catch {
    return url;
  }
}

// --- Slug suggestions ("Optimize", Rebrandly-style) -------------------------
const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // drop look-alikes (0/o/1/l)
export function randomSlug(len: number): string {
  const a = crypto.getRandomValues(new Uint32Array(len));
  let s = "";
  for (let i = 0; i < len; i++) s += SLUG_ALPHABET[a[i] % SLUG_ALPHABET.length];
  return s;
}
export function slugWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
}
export function toSlug(text: string, mode: "plain" | "dash" | "camel"): string {
  const words = slugWords(text).slice(0, 8);
  if (!words.length) return "";
  const out =
    mode === "dash"
      ? words.join("-")
      : mode === "camel"
        ? words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("")
        : words.join("");
  return out.slice(0, 32);
}
/** Source text for "suggested" slugs: the fetched page title if we have it, else
 *  the destination's host + first path segment. */
export function suggestSource(destination: string, metaTitle?: string): string {
  if (metaTitle?.trim()) return metaTitle;
  try {
    const u = new URL(destination);
    const host = u.hostname.replace(/^www\./, "").split(".")[0];
    // Prefer meaningful path segments; skip tiny prefixes (/t/, /p/) and numeric ids.
    const segs = u.pathname.split("/").filter((s) => s.length > 2 && !/^\d+$/.test(s));
    return segs.length ? segs.join(" ") : host;
  } catch {
    return "";
  }
}
// "shortest"/"random" lengths come from the admin setting (config.slugLength);
// desc strings for those two are computed at render time.
export const SLUG_OPTIONS = [
  { kind: "shortest", label: "Shortest", desc: "", needsSource: false },
  { kind: "random", label: "Random", desc: "", needsSource: false },
  { kind: "plain", label: "Suggested", desc: "Words from the destination, joined", needsSource: true },
  { kind: "dash", label: "Suggested with dash", desc: "Dash-separated (SEO-friendly)", needsSource: true },
  { kind: "camel", label: "Suggested camel case", desc: "camelCase from the destination", needsSource: true },
] as const;

export type SlugKind = (typeof SLUG_OPTIONS)[number]["kind"];
