import { useConfig, useShortHost } from "@/lib/config";
import type { UrlMetaDTO } from "@shared/types";

/** Rich link-preview card as a platform unfurls our short link — source shown is
 *  us (short host + logo) with a "via <dest>" note; content from the destination. */
export function DestinationPreview({
  meta,
  loading,
  fallbackDomain,
  fallbackImage,
}: {
  meta: UrlMetaDTO | null;
  loading: boolean;
  fallbackDomain: string;
  fallbackImage?: string;
}) {
  const shortHost = useShortHost();
  const { config } = useConfig();
  const source = meta?.domain || fallbackDomain;
  const img = meta?.image || fallbackImage;
  const hide = (e: { currentTarget: HTMLImageElement }) => {
    e.currentTarget.style.display = "none";
  };
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {img ? (
        <img
          src={img}
          alt=""
          className="aspect-[1.91/1] w-full border-b object-cover"
          onError={hide}
        />
      ) : null}
      <div className="flex items-start gap-3 p-3">
        {config.logoUrl ? (
          <img src={config.logoUrl} alt="" className="mt-0.5 size-5 rounded" onError={hide} />
        ) : (
          <div className="mt-0.5 size-5 shrink-0 rounded" style={{ backgroundColor: config.brandColor }} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-muted-foreground">
            <span className="font-medium text-foreground/75">{shortHost}</span>
            {source ? <span> · via {source}</span> : null}
          </div>
          <div className="line-clamp-2 text-sm font-medium">
            {loading && !meta ? "Loading preview…" : meta?.title || source}
          </div>
          {meta?.description ? (
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{meta.description}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
