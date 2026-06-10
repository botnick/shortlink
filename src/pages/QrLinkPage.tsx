import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Copy, Download, ExternalLink, Loader2 } from "lucide-react";
import { useConfig } from "@/lib/config";
import {
  composeFrame,
  downloadBlob,
  makeDefault,
  renderQrSvg,
  svgDataUrl,
  svgToRaster,
  type QrCfg,
} from "@/lib/qr";
import { Button } from "@/components/ui/button";

interface QrData {
  shortUrl: string;
  color: string | null;
  logo: string | null;
  qrConfig?: Record<string, unknown> | null;
}

type Status = "loading" | "ready" | "notfound";

/**
 * Public, login-free QR page for any active link (the equivalent of
 * lnk.ua/qr/<slug>): a branded, downloadable QR of the short URL. Styling is
 * pulled from the link's project (brand colour + logo) via /api/qr/<slug>.
 */
export function QrLinkPage() {
  const { slug = "" } = useParams();
  const { config } = useConfig();
  const [data, setData] = useState<QrData | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [svg, setSvg] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedDirect, setCopiedDirect] = useState(false);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    fetch(`/api/qr/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: QrData) => {
        if (!active) return;
        setData(d);
        setStatus("ready");
      })
      .catch(() => active && setStatus("notfound"));
    return () => {
      active = false;
    };
  }, [slug]);

  // Same config as the QR studio + editor: makeDefault(brand) + project logo,
  // then the design saved on the link — so every QR view stays in sync.
  const cfg = useMemo<QrCfg | null>(() => {
    if (!data) return null;
    const base = makeDefault(data.color || config.brandColor);
    const withLogo = data.logo ? { ...base, logoSrc: data.logo } : base;
    return data.qrConfig ? { ...withLogo, ...(data.qrConfig as Partial<QrCfg>) } : withLogo;
  }, [data, config.brandColor]);

  useEffect(() => {
    if (!cfg || !data) return;
    let active = true;
    renderQrSvg(cfg, data.shortUrl)
      .then((raw) => active && setSvg(composeFrame(raw, cfg).svg))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [cfg, data]);

  async function download(kind: "png" | "svg") {
    if (!cfg || !data) return;
    const composed = composeFrame(await renderQrSvg(cfg, data.shortUrl), cfg);
    if (kind === "svg") {
      downloadBlob(
        new Blob([composed.svg], { type: "image/svg+xml" }),
        `qr-${slug}.svg`,
      );
    } else {
      downloadBlob(await svgToRaster(composed, cfg.exportSize, "image/png"), `qr-${slug}.png`);
    }
  }

  function copy() {
    if (!data) return;
    void navigator.clipboard.writeText(data.shortUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {config.logoUrl ? (
          <img src={config.logoUrl} alt="" className="size-6 rounded" />
        ) : null}
        <span>{config.appName}</span>
      </div>

      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        {status === "loading" && (
          <div className="flex aspect-square items-center justify-center text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}

        {status === "notfound" && (
          <div className="flex aspect-square flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm font-medium">This link isn’t available</p>
            <p className="text-xs text-muted-foreground">
              It may have been removed, paused, or expired.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-1">
              <Link to="/">Go home</Link>
            </Button>
          </div>
        )}

        {status === "ready" && data && (
          <div className="space-y-5">
            <div className="mx-auto aspect-square w-full max-w-[260px] overflow-hidden rounded-xl">
              {svg ? (
                <img src={svgDataUrl(svg)} alt={`QR code for ${data.shortUrl}`} className="size-full" />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground">
                  <Loader2 className="size-6 animate-spin" />
                </div>
              )}
            </div>

            <p className="text-center text-xs text-muted-foreground">
              Scan with your phone camera to open
            </p>

            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">{data.shortUrl}</span>
              <button
                type="button"
                onClick={copy}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Copy link"
              >
                {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => void download("png")}>
                <Download /> PNG
              </Button>
              <Button variant="outline" onClick={() => void download("svg")}>
                <Download /> SVG
              </Button>
            </div>

            <button
              type="button"
              onClick={() => {
                const origin = (() => {
                  try {
                    return new URL(data.shortUrl).origin;
                  } catch {
                    return window.location.origin;
                  }
                })();
                void navigator.clipboard.writeText(`${origin}/qr/${slug}.svg`);
                setCopiedDirect(true);
                setTimeout(() => setCopiedDirect(false), 1500);
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {copiedDirect ? (
                <Check className="size-3.5 text-emerald-600" />
              ) : (
                <Copy className="size-3.5" />
              )}
              Copy direct image link
            </button>

            <a
              href={data.shortUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Open link <ExternalLink className="size-3.5" />
            </a>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Powered by <span className="font-medium text-foreground/70">{config.appName}</span>
      </p>
    </div>
  );
}
