import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Copy, Download, ExternalLink, Loader2 } from "lucide-react";
import { useConfig } from "@/lib/config";
import { downloadBlob, svgToRaster } from "@/lib/qr";
import { Button } from "@/components/ui/button";

type Status = "loading" | "ready" | "notfound";

/**
 * Public, login-free QR page for any active link. The QR shown here is the exact
 * same server-rendered image as the direct link /qr/<slug>.svg and the editor
 * card — one source, so every QR view of a link is identical (no stored copies).
 */
export function QrLinkPage() {
  const { slug = "" } = useParams();
  const { config } = useConfig();
  const [status, setStatus] = useState<Status>("loading");
  const [svg, setSvg] = useState("");
  const [shortUrl, setShortUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedDirect, setCopiedDirect] = useState(false);
  const directUrl = `${window.location.origin}/qr/${slug}.svg`;

  useEffect(() => {
    let active = true;
    setStatus("loading");
    Promise.all([
      fetch(`/qr/${encodeURIComponent(slug)}.svg`).then((r) =>
        r.ok ? r.text() : Promise.reject(new Error("not found")),
      ),
      fetch(`/api/qr/${encodeURIComponent(slug)}`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([svgText, meta]) => {
        if (!active) return;
        setSvg(svgText);
        setShortUrl(meta?.shortUrl ?? `${window.location.origin}/${slug}`);
        setStatus("ready");
      })
      .catch(() => active && setStatus("notfound"));
    return () => {
      active = false;
    };
  }, [slug]);

  async function download(kind: "png" | "svg") {
    if (!svg) return;
    if (kind === "svg") {
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `qr-${slug}.svg`);
    } else {
      downloadBlob(
        await svgToRaster({ svg, width: 1024, height: 1024 }, 1024, "image/png"),
        `qr-${slug}.png`,
      );
    }
  }

  function copyTo(text: string, set: (v: boolean) => void) {
    void navigator.clipboard.writeText(text);
    set(true);
    setTimeout(() => set(false), 1500);
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

        {status === "ready" && (
          <div className="space-y-5">
            <div className="mx-auto aspect-square w-full max-w-[260px] overflow-hidden rounded-xl">
              <img src={directUrl} alt={`QR code for ${shortUrl}`} className="size-full" />
            </div>

            <p className="text-center text-xs text-muted-foreground">
              Scan with your phone camera to open
            </p>

            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">{shortUrl}</span>
              <button
                type="button"
                onClick={() => copyTo(shortUrl, setCopied)}
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
              onClick={() => copyTo(directUrl, setCopiedDirect)}
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
              href={shortUrl}
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
