import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/lib/config";
import { composeFrame, makeDefault, renderQrSvg, svgDataUrl, type QrCfg } from "@/lib/qr";
import { CopyRow } from "./CopyRow";

/** QR block in the preview rail: a live QR plus its public /qr/<slug> share page.
 *  Rendered client-side from the link's own short URL + brand so it works the
 *  same whether the link is on the default host or a custom domain. */
export function QrCard({
  shortUrl,
  slug,
  linkId,
  savedConfig,
}: {
  shortUrl: string;
  slug: string;
  linkId: string;
  savedConfig?: Record<string, unknown> | null;
}) {
  const { config } = useConfig();
  const [svg, setSvg] = useState("");
  // The QR (and its share page) live on the link's host, not necessarily this one.
  const origin = (() => {
    try {
      return new URL(shortUrl).origin;
    } catch {
      return window.location.origin;
    }
  })();
  const qrUrl = `${origin}/qr/${slug}`;

  useEffect(() => {
    let active = true;
    const base = makeDefault(config.brandColor);
    // The app logo is available as the centre-logo source, but OFF by default —
    // never auto-stamp it onto a user's QR; they opt in via the QR studio.
    const withLogo = config.logoUrl ? { ...base, logoSrc: config.logoUrl } : base;
    const cfg = savedConfig ? { ...withLogo, ...(savedConfig as Partial<QrCfg>) } : withLogo;
    renderQrSvg(cfg, shortUrl)
      .then((raw) => {
        if (active) setSvg(composeFrame(raw, cfg).svg);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [shortUrl, config.brandColor, config.logoUrl, savedConfig]);

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <span className="text-xs font-medium text-muted-foreground">QR code</span>
      <div className="mx-auto size-32">
        {svg ? (
          <img src={svgDataUrl(svg)} alt="QR code" className="size-full" />
        ) : (
          <div className="flex size-full items-center justify-center rounded-lg border">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" size="sm" asChild>
          <a href={qrUrl} target="_blank" rel="noreferrer">
            Open <ExternalLink className="size-3.5" />
          </a>
        </Button>
        <Button type="button" variant="outline" size="sm" asChild>
          <RouterLink to={`/links/${linkId}/qr`}>Customize</RouterLink>
        </Button>
      </div>
      <div className="space-y-1.5 border-t pt-3">
        <span className="text-[11px] text-muted-foreground">Direct image link (SVG)</span>
        <CopyRow value={`${origin}/qr/${slug}.svg`} label="Copy direct QR image link" />
      </div>
    </section>
  );
}
