import { Check, QrCode } from "lucide-react";
import { CopyRow } from "@/components/link-editor/CopyRow";
import { QrCard } from "@/components/link-editor/QrCard";
import type { LinkEditorForm } from "./useLinkEditorForm";

/** The sticky right-hand rail: the live short link, the link-unfurl preview, and
 *  the QR block (a placeholder until the link is created). */
export function PreviewRail({ form }: { form: LinkEditorForm }) {
  const {
    shortUrlText,
    aliasOrSlug,
    previewMode,
    pvImage,
    config,
    shortHost,
    pvTitle,
    destLoading,
    pvDesc,
    isEdit,
    link,
  } = form;

  return (
    <aside className="space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-6 lg:h-fit">
      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <span className="text-xs font-medium text-muted-foreground">Your short link</span>
        <CopyRow value={shortUrlText} label="Copy short link" />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Character count</span>
          <span className="flex items-center gap-1 font-medium text-foreground/70">
            {shortUrlText.length}
            {/^[a-zA-Z0-9_-]{3,32}$/.test(aliasOrSlug) && (
              <Check className="size-3 text-emerald-600" />
            )}
          </span>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Link preview</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {previewMode === "off"
              ? "Plain link"
              : previewMode === "destination"
                ? "From page"
                : "Custom card"}
          </span>
        </div>

        {previewMode === "off" ? (
          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
            <div className="truncate text-sm font-medium text-sky-600">{shortUrlText}</div>
            <p className="text-[11px] text-muted-foreground">
              No preview card — shares as a plain link.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            {pvImage ? (
              <img
                src={pvImage}
                alt=""
                className="aspect-[1.91/1] w-full border-b object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <div className="aspect-[1.91/1] w-full animate-pulse border-b bg-muted" />
            )}
            <div className="flex items-start gap-2 p-3">
              {config.logoUrl ? (
                <img src={config.logoUrl} alt="" className="mt-0.5 size-4 rounded" />
              ) : (
                <div
                  className="mt-0.5 size-4 shrink-0 rounded"
                  style={{ backgroundColor: config.brandColor }}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] text-muted-foreground">{shortHost}</div>
                <div className="line-clamp-2 text-[13px] font-medium leading-snug">
                  {pvTitle || (destLoading ? "Loading…" : "Add a title")}
                </div>
                {pvDesc ? (
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                    {pvDesc}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </section>

      {isEdit && link ? (
        <QrCard
          shortUrl={link.shortUrl}
          slug={link.slug}
          linkId={link.id}
          savedConfig={link.qrConfig}
        />
      ) : (
        <section className="space-y-3 rounded-2xl border bg-card p-4">
          <span className="text-xs font-medium text-muted-foreground">QR code</span>
          <div className="mx-auto flex size-32 items-center justify-center rounded-lg border border-dashed">
            <QrCode className="size-7 text-muted-foreground/60" />
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            Generated after you create the link
          </p>
        </section>
      )}
    </aside>
  );
}
