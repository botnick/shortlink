import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ImageUp,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useConfig } from "@/lib/config";
import { api } from "@/lib/api";
import { extractPalette } from "@/lib/palette";
import { schemesFor, type ColorScheme } from "@/lib/colorSchemes";
import {
  composeFrame,
  downloadBlob,
  makeDefault,
  renderQrSvg,
  svgToRaster,
  type DotType,
  type Ecc,
  type FrameStyle,
  type QrCfg,
} from "@/lib/qr";
import type { AssetDTO, ProjectDTO, QrPresetDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "@/components/ColorPicker";

const CURATED = [
  "#000000",
  "#1e293b",
  "#2563eb",
  "#4f46e5",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#16a34a",
  "#0d9488",
];

const DOT_SHAPES: { value: DotType; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "extra-rounded", label: "Extra rounded" },
  { value: "dots", label: "Dots" },
  { value: "classy", label: "Classy" },
  { value: "classy-rounded", label: "Classy rounded" },
];
const FRAME_STYLES: { value: FrameStyle; label: string }[] = [
  { value: "none", label: "None" },
  { value: "box", label: "Border" },
  { value: "bottom", label: "Banner below" },
  { value: "top", label: "Banner above" },
  { value: "pill", label: "Pill" },
  { value: "tag", label: "Tag" },
  { value: "ribbon", label: "Ribbon" },
  { value: "bubble", label: "Bubble" },
  { value: "dual", label: "Dual" },
  { value: "ticket", label: "Ticket" },
  { value: "underline", label: "Underline" },
];

// A realistic 21×21 QR placeholder (finder + timing patterns + dense data) so
// each frame option's thumbnail reads as a real QR, without rendering one per cell.
function miniQr(cfg: QrCfg): string {
  const N = 21;
  const c = 48;
  const S = N * c;
  const round =
    cfg.dotsType === "dots" ||
    cfg.dotsType.includes("rounded") ||
    cfg.dotsType === "classy-rounded";
  const dotR = round ? c * 0.42 : c * 0.1;

  const finder = (gx: number, gy: number) => {
    const x = gx * c;
    const y = gy * c;
    return (
      `<rect x="${x}" y="${y}" width="${7 * c}" height="${7 * c}" rx="${round ? c * 0.95 : c * 0.5}" fill="${cfg.cornerSquareColor}"/>` +
      `<rect x="${x + c}" y="${y + c}" width="${5 * c}" height="${5 * c}" rx="${round ? c * 0.75 : c * 0.3}" fill="#ffffff"/>` +
      `<rect x="${x + 2 * c}" y="${y + 2 * c}" width="${3 * c}" height="${3 * c}" rx="${round ? c * 0.55 : c * 0.2}" fill="${cfg.cornerDotColor}"/>`
    );
  };
  const inFinder = (gx: number, gy: number) =>
    (gx < 8 && gy < 8) || (gx >= N - 8 && gy < 8) || (gx < 8 && gy >= N - 8);

  const m = c * 0.86;
  const off = (c - m) / 2;
  let dots = "";
  for (let gx = 0; gx < N; gx++) {
    for (let gy = 0; gy < N; gy++) {
      if (inFinder(gx, gy)) continue;
      const on =
        gx === 6 || gy === 6
          ? (gx + gy) % 2 === 0 // timing pattern
          : (((gx ^ gy) * 7 + gx * 3 + gy * 5) & 7) < 4; // ~50% pseudo-random data
      if (!on) continue;
      dots += `<rect x="${gx * c + off}" y="${gy * c + off}" width="${m}" height="${m}" rx="${dotR}" fill="${cfg.fg}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><rect width="${S}" height="${S}" fill="#ffffff"/>${dots}${finder(0, 0)}${finder(N - 7, 0)}${finder(0, N - 7)}</svg>`;
}

// --- primitives -------------------------------------------------------------
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 appearance-none rounded-lg border bg-background py-1 pl-3 pr-8 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Swatch({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={color}
      className={cn(
        "size-7 rounded-md border transition-transform hover:scale-110",
        active && "ring-2 ring-ring ring-offset-2 ring-offset-card",
      )}
      style={{ backgroundColor: color }}
    />
  );
}

function Range({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
      />
      <span className="w-9 text-right font-mono text-xs text-muted-foreground">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

const CHECKER = {
  backgroundColor: "#fff",
  backgroundImage:
    "linear-gradient(45deg,#e2e8f0 25%,transparent 25%),linear-gradient(-45deg,#e2e8f0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e2e8f0 75%),linear-gradient(-45deg,transparent 75%,#e2e8f0 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
} as const;

// --- studio -----------------------------------------------------------------
export function QrStudio({
  url,
  downloadName,
  project,
}: {
  url: string;
  downloadName: string;
  project?: ProjectDTO;
}) {
  const { config } = useConfig();
  // Default to the project's brand presets (color + logo), falling back to global.
  const brand = project?.color || config.brandColor;
  const [cfg, setCfg] = useState<QrCfg>(() => {
    const base = makeDefault(brand);
    return project?.logo ? { ...base, logoSrc: project.logo, logo: true } : base;
  });
  const [markup, setMarkup] = useState("");
  const [extracted, setExtracted] = useState<string[]>([]);
  const [saved, setSaved] = useState<QrPresetDTO[]>([]);
  const [assets, setAssets] = useState<AssetDTO[]>([]);
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [mainColor, setMainColor] = useState(brand);
  const [format, setFormat] = useState<"png" | "svg" | "jpeg">("png");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const seq = useRef(0);

  const set = <K extends keyof QrCfg>(key: K, value: QrCfg[K]) =>
    setCfg((c) => ({ ...c, [key]: value }));
  const setAll = (color: string) => {
    setMainColor(color);
    setCfg((c) => ({ ...c, fg: color, cornerSquareColor: color, cornerDotColor: color }));
  };
  const applyScheme = (s: ColorScheme) =>
    setCfg((c) => ({ ...c, gradient: false, fg: s.fg, cornerSquareColor: s.cornerSquareColor, cornerDotColor: s.cornerDotColor }));

  const schemes = useMemo(() => schemesFor(mainColor), [mainColor]);
  const frameThumbs = useMemo(() => {
    const ph = miniQr(cfg);
    return FRAME_STYLES.map((f) => ({
      ...f,
      svg: composeFrame(ph, { ...cfg, frameStyle: f.value }).svg,
    }));
  }, [cfg]);
  const colorPresets = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of ["#000000", config.brandColor, ...CURATED, ...extracted]) {
      const k = c.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(c);
      }
    }
    return out.slice(0, 18);
  }, [config.brandColor, extracted]);

  // live preview (async render → frame compose), debounced + race-guarded
  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(() => {
      renderQrSvg(cfg, url)
        .then((qrSvg) => {
          if (id !== seq.current) return;
          setMarkup(composeFrame(qrSvg, cfg).svg);
        })
        .catch(() => {});
    }, 100);
    return () => clearTimeout(t);
  }, [cfg, url]);

  useEffect(() => {
    const q = project ? `?projectId=${project.id}` : "";
    api
      .get<{ presets: QrPresetDTO[] }>(`/qr-presets${q}`)
      .then((r) => setSaved(r.presets))
      .catch(() => {});
    api.get<{ assets: AssetDTO[] }>("/assets").then((r) => setAssets(r.assets)).catch(() => {});
  }, [project]);

  function onExtract(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      extractPalette(String(reader.result))
        .then((colors) => {
          if (colors.length === 0) return toast.error("No usable colors in that image");
          setExtracted(colors);
          setAll(colors[0]);
          toast.success(`Pulled ${colors.length} colors`);
        })
        .catch(() => toast.error("Couldn't read that image"));
    };
    reader.readAsDataURL(file);
  }

  function onUpload(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setCfg((c) => ({ ...c, logoSrc: dataUrl, logo: true }));
      api.post<{ asset: AssetDTO }>("/assets", { name: file.name, dataUrl }).then((r) => setAssets((a) => [r.asset, ...a])).catch(() => {});
    };
    reader.readAsDataURL(file);
  }

  function pickAsset(a: AssetDTO) {
    fetch(a.url)
      .then((r) => r.blob())
      .then((blob) => new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(String(reader.result));
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      }))
      .then((dataUrl) => setCfg((c) => ({ ...c, logoSrc: dataUrl, logo: true })))
      .catch(() => toast.error("Couldn't load that logo"));
  }

  function deleteAsset(id: string) {
    setAssets((a) => a.filter((x) => x.id !== id));
    api.delete(`/assets/${id}`).catch(() => {});
  }

  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    api.post<{ preset: QrPresetDTO }>("/qr-presets", { name, config: { ...cfg, palette: extracted }, projectId: project?.id })
      .then((r) => {
        setSaved((s) => [r.preset, ...s.filter((p) => p.name !== name)]);
        setActivePresetId(r.preset.id);
        setNaming(false);
        setPresetName("");
        toast.success(`Saved “${name}”`);
      })
      .catch(() => toast.error("Couldn't save preset"));
  }

  function updatePreset() {
    const cur = saved.find((p) => p.id === activePresetId);
    if (!cur) return;
    api.patch<{ preset: QrPresetDTO }>(`/qr-presets/${cur.id}`, { name: cur.name, config: { ...cfg, palette: extracted } })
      .then((r) => {
        setSaved((s) => s.map((p) => (p.id === r.preset.id ? r.preset : p)));
        toast.success(`Updated “${cur.name}”`);
      })
      .catch(() => toast.error("Couldn't update preset"));
  }

  function deletePreset(id: string) {
    setSaved((s) => s.filter((p) => p.id !== id));
    if (id === activePresetId) setActivePresetId(null);
    api.delete(`/qr-presets/${id}`).catch(() => {});
  }

  function applyPreset(p: QrPresetDTO) {
    const { palette, ...rest } = p.config as Record<string, unknown>;
    if (Array.isArray(palette)) setExtracted(palette.filter((x): x is string => typeof x === "string"));
    const next = rest as unknown as QrCfg;
    setMainColor(next.fg ?? mainColor);
    setActivePresetId(p.id);
    setCfg(next);
  }

  async function exportQr(fmt: "png" | "svg" | "jpeg") {
    setBusy(true);
    try {
      const composed = composeFrame(await renderQrSvg(cfg, url), cfg);
      if (fmt === "svg") {
        downloadBlob(new Blob([composed.svg], { type: "image/svg+xml" }), `${downloadName}-qr.svg`);
      } else {
        const blob = await svgToRaster(composed, cfg.exportSize, fmt === "jpeg" ? "image/jpeg" : "image/png");
        downloadBlob(blob, `${downloadName}-qr.${fmt}`);
      }
    } catch {
      toast.error("Export failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyQr() {
    try {
      const composed = composeFrame(await renderQrSvg(cfg, url), cfg);
      const blob = await svgToRaster(composed, cfg.exportSize, "image/png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  const showFrameText = cfg.frameStyle !== "none" && cfg.frameStyle !== "box";

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:items-start">
      {/* preview */}
      <div className="lg:sticky lg:top-20">
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <div className="flex items-center justify-center rounded-lg border p-3" style={CHECKER}>
            <div
              className="w-full max-w-[230px] [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: markup }}
            />
          </div>
          <Segmented
            value={format}
            onChange={setFormat}
            options={[
              { value: "png", label: "PNG" },
              { value: "svg", label: "SVG" },
              { value: "jpeg", label: "JPEG" },
            ]}
          />
          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy} onClick={() => exportQr(format)}>
              <Download /> Download
            </Button>
            <Button variant="outline" size="icon" onClick={copyQr} aria-label="Copy image">
              {copied ? <Check className="text-emerald-500" /> : <Copy />}
            </Button>
          </div>
          <button
            type="button"
            onClick={() => {
              setExtracted([]);
              setMainColor(config.brandColor);
              setCfg(makeDefault(config.brandColor));
            }}
            className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3.5" /> Reset
          </button>
        </div>
      </div>

      {/* controls */}
      <div className="space-y-4">
        <Section title="Frame">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {frameThumbs.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => set("frameStyle", f.value)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-all",
                  cfg.frameStyle === f.value
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "bg-muted/40 hover:border-foreground/20 hover:bg-muted",
                )}
              >
                <span
                  className="flex h-12 w-full items-center justify-center [&>svg]:max-h-12 [&>svg]:w-auto [&>svg]:max-w-full [&>svg]:drop-shadow-sm"
                  dangerouslySetInnerHTML={{ __html: f.svg }}
                />
                <span
                  className={cn(
                    "text-[10px] font-medium leading-tight",
                    cfg.frameStyle === f.value ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {f.label}
                </span>
              </button>
            ))}
          </div>
          {cfg.frameStyle !== "none" && (
            <>
              {showFrameText && (
                <Field label="Text">
                  <input
                    value={cfg.frameText}
                    onChange={(e) => set("frameText", e.target.value)}
                    maxLength={18}
                    placeholder="SCAN ME"
                    className="h-9 w-40 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>
              )}
              <Field label="Frame color">
                <ColorPicker value={cfg.frameColor} onChange={(v) => set("frameColor", v)} presets={colorPresets} />
              </Field>
              {showFrameText && (
                <Field label="Text color">
                  <ColorPicker value={cfg.frameTextColor} onChange={(v) => set("frameTextColor", v)} presets={["#ffffff", "#000000", ...colorPresets]} />
                </Field>
              )}
              {showFrameText && (
                <Field label="Scan icon">
                  <Switch checked={cfg.frameIcon} onCheckedChange={(v) => set("frameIcon", v)} />
                </Field>
              )}
              <Field label="Rounded corners">
                <Switch checked={cfg.frameRound} onCheckedChange={(v) => set("frameRound", v)} />
              </Field>
            </>
          )}
        </Section>

        <Section title="Color">
          <div className="flex flex-wrap items-center gap-1.5">
            {colorPresets.map((c) => (
              <Swatch key={c} color={c} active={cfg.fg.toLowerCase() === c.toLowerCase()} onClick={() => setAll(c)} />
            ))}
            <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
              <ImageUp className="size-3.5" /> From image
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => onExtract(e.target.files?.[0])} />
            </label>
          </div>

          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Auto-match</span>
              <ColorPicker value={mainColor} onChange={setAll} presets={colorPresets} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {schemes.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => applyScheme(s)}
                  className="flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors hover:bg-accent"
                >
                  <span className="flex gap-1">
                    <span className="size-4 rounded-sm border" style={{ backgroundColor: s.fg }} />
                    <span className="size-4 rounded-sm border" style={{ backgroundColor: s.cornerSquareColor }} />
                    <span className="size-4 rounded-sm border" style={{ backgroundColor: s.cornerDotColor }} />
                  </span>
                  <span className="text-xs font-medium">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          <Field label="Fill">
            <Segmented
              value={cfg.gradient ? "gradient" : "solid"}
              onChange={(v) => set("gradient", v === "gradient")}
              options={[
                { value: "solid", label: "Solid" },
                { value: "gradient", label: "Gradient" },
              ]}
            />
          </Field>
          {cfg.gradient && (
            <>
              <Field label="Gradient to">
                <ColorPicker value={cfg.fg2} onChange={(v) => set("fg2", v)} presets={colorPresets} />
              </Field>
              <Field label="Direction">
                <Segmented
                  value={cfg.gradientType}
                  onChange={(v) => set("gradientType", v)}
                  options={[
                    { value: "linear", label: "Linear" },
                    { value: "radial", label: "Radial" },
                  ]}
                />
              </Field>
            </>
          )}
        </Section>

        <Section title="Pattern">
          <Field label="Dots">
            <Select value={cfg.dotsType} onChange={(v) => set("dotsType", v)} options={DOT_SHAPES} />
          </Field>
          <Field label="Eye frame">
            <Select
              value={cfg.cornerSquareType}
              onChange={(v) => set("cornerSquareType", v)}
              options={[
                { value: "extra-rounded", label: "Rounded" },
                { value: "square", label: "Square" },
                { value: "dot", label: "Circle" },
              ]}
            />
          </Field>
          <Field label="Eye center">
            <Select
              value={cfg.cornerDotType}
              onChange={(v) => set("cornerDotType", v)}
              options={[
                { value: "square", label: "Square" },
                { value: "dot", label: "Circle" },
              ]}
            />
          </Field>
          <Field label="Eye frame color">
            <ColorPicker value={cfg.cornerSquareColor} onChange={(v) => set("cornerSquareColor", v)} presets={colorPresets} />
          </Field>
          <Field label="Eye center color">
            <ColorPicker value={cfg.cornerDotColor} onChange={(v) => set("cornerDotColor", v)} presets={colorPresets} />
          </Field>
        </Section>

        <Section title="Background">
          <Field label="Transparent">
            <Switch checked={cfg.transparent} onCheckedChange={(v) => set("transparent", v)} />
          </Field>
          {!cfg.transparent && (
            <Field label="Color">
              <ColorPicker value={cfg.bg} onChange={(v) => set("bg", v)} presets={["#ffffff", ...colorPresets]} />
            </Field>
          )}
        </Section>

        <Section title="Logo">
          <Field label="Show logo">
            <Switch checked={cfg.logo} onCheckedChange={(v) => set("logo", v)} />
          </Field>
          {cfg.logo && (
            <>
              <Field label="Image">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent">
                  <ImageUp className="size-3.5" />
                  {cfg.logoSrc ? "Replace" : "Upload"}
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => onUpload(e.target.files?.[0])} />
                </label>
              </Field>
              {(project?.logo || assets.length > 0) && (
                <div className="space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">Saved logos</span>
                  <div className="flex flex-wrap gap-2">
                    {project?.logo && (
                      <button
                        type="button"
                        onClick={() =>
                          setCfg((c) => ({ ...c, logoSrc: project.logo!, logo: true }))
                        }
                        title="Project logo"
                        className="block size-12 overflow-hidden rounded-lg border-2 border-primary/50 bg-white p-1 hover:ring-2 hover:ring-ring"
                      >
                        <img src={project.logo} alt="" className="size-full object-contain" />
                      </button>
                    )}
                    {assets.map((a) => (
                      <div key={a.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => pickAsset(a)}
                          title={a.name || "logo"}
                          className="block size-12 overflow-hidden rounded-lg border bg-white p-1 hover:ring-2 hover:ring-ring"
                        >
                          <img src={a.url} alt="" className="size-full object-contain" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteAsset(a.id)}
                          aria-label="Delete logo"
                          className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Field label="Size">
                <Range value={cfg.logoSize} min={0.1} max={0.6} step={0.05} onChange={(v) => set("logoSize", v)} format={(v) => `${Math.round(v * 100)}%`} />
              </Field>
              <Field label="Clear dots behind">
                <Switch checked={cfg.hideBgDots} onCheckedChange={(v) => set("hideBgDots", v)} />
              </Field>
            </>
          )}
        </Section>

        <Section
          title="My presets"
          action={
            !naming && (
              <div className="flex items-center gap-3">
                {activePresetId && (
                  <button type="button" onClick={updatePreset} className="text-xs font-medium text-primary hover:underline">
                    Update
                  </button>
                )}
                <button type="button" onClick={() => setNaming(true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  <Plus className="size-3.5" /> Save new
                </button>
              </div>
            )
          }
        >
          {naming && (
            <form onSubmit={(e) => { e.preventDefault(); savePreset(); }} className="flex items-center gap-1.5">
              <input
                autoFocus
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Brand / project name"
                maxLength={32}
                className="h-8 flex-1 rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="sm">Save</Button>
              <button type="button" onClick={() => { setNaming(false); setPresetName(""); }} className="px-1 text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </form>
          )}
          {saved.length > 0 ? (
            <div className="space-y-1.5">
              {saved.map((p) => {
                const c = p.config as unknown as { fg?: string; cornerSquareColor?: string; cornerDotColor?: string };
                return (
                  <div key={p.id} className={cn("flex items-center gap-3 rounded-lg border bg-background p-2", activePresetId === p.id && "ring-2 ring-primary")}>
                    <button type="button" onClick={() => applyPreset(p)} className="flex flex-1 items-center gap-3 overflow-hidden text-left">
                      <span className="flex shrink-0 overflow-hidden rounded-md border">
                        <span className="size-6" style={{ backgroundColor: c.fg }} />
                        <span className="size-6" style={{ backgroundColor: c.cornerSquareColor }} />
                        <span className="size-6" style={{ backgroundColor: c.cornerDotColor }} />
                      </span>
                      <span className="truncate text-sm font-medium">{p.name}</span>
                    </button>
                    <button type="button" onClick={() => deletePreset(p.id)} aria-label={`Delete ${p.name}`} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            !naming && (
              <p className="text-xs text-muted-foreground">
                Save a style to reuse it across links and brands — colors, frame and logo stay with it.
              </p>
            )
          )}
        </Section>

        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform", advanced && "rotate-180")} />
          Advanced
        </button>
        {advanced && (
          <Section title="Output">
            <Field label="Error correction">
              <Segmented
                value={cfg.ecc}
                onChange={(v) => set("ecc", v)}
                options={(["L", "M", "Q", "H"] as Ecc[]).map((e) => ({ value: e, label: e }))}
              />
            </Field>
            <Field label="Quiet zone">
              <Range value={cfg.margin} min={0} max={40} onChange={(v) => set("margin", v)} />
            </Field>
            <Field label="Export size">
              <Segmented
                value={String(cfg.exportSize)}
                onChange={(v) => set("exportSize", Number(v))}
                options={[
                  { value: "512", label: "512" },
                  { value: "1024", label: "1024" },
                  { value: "2048", label: "2048" },
                ]}
              />
            </Field>
          </Section>
        )}
      </div>
    </div>
  );
}
