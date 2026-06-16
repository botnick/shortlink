import { Check, Link2, Megaphone, Monitor, Plus, Share2, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { isHttpUrl, UTM_KEYS } from "@/lib/linkForm";
import type { PreviewMode } from "@shared/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppleLogo, AndroidLogo } from "@/components/icons";
import { Collapsible } from "@/components/link-editor/Collapsible";
import { DestinationPreview } from "@/components/link-editor/DestinationPreview";
import type { LinkEditorForm } from "./useLinkEditorForm";

/** The progressive-disclosure advanced sections (UTM tracking, device routing,
 *  social preview) — collapsed behind a single "Add …" button on create. */
export function AdvancedSections({ form }: { form: LinkEditorForm }) {
  const {
    showAdvanced,
    setShowAdvanced,
    utmCount,
    destValid,
    utm,
    setUtmField,
    deepCount,
    iosUrl,
    setIosUrl,
    androidUrl,
    setAndroidUrl,
    desktopUrl,
    setDesktopUrl,
    previewMode,
    setPreviewMode,
    destMeta,
    destLoading,
    previewDomain,
    genDataUrl,
    shortHost,
    ogTitle,
    setOgTitle,
    ogDescription,
    setOgDescription,
    ogSource,
    setOgSource,
    canvasRef,
    ogImage,
    setOgImage,
    pickOgImage,
    config,
  } = form;

  return (
    <div className="order-last space-y-4 lg:order-none lg:col-start-1 lg:row-start-2">
      {showAdvanced ? (
        <>
          {/* Campaign tracking (UTM) */}
          <Collapsible
            icon={Megaphone}
            title="Campaign tracking (UTM)"
            summary={
              utmCount > 0
                ? `${utmCount} parameter${utmCount > 1 ? "s" : ""} set`
                : "Tag traffic so your analytics tools attribute it"
            }
            defaultOpen={utmCount > 0}
          >
            {!destValid && (
              <p className="text-[11px] text-muted-foreground">Enter a valid URL above first.</p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {UTM_KEYS.map((k) => (
                <div key={k} className="space-y-1">
                  <Label htmlFor={`utm_${k}`} className="text-[11px] text-muted-foreground">
                    utm_{k}
                  </Label>
                  <Input
                    id={`utm_${k}`}
                    disabled={!destValid}
                    placeholder={
                      k === "source"
                        ? "newsletter"
                        : k === "medium"
                          ? "email"
                          : k === "campaign"
                            ? "spring_sale"
                            : ""
                    }
                    value={utm[k]}
                    onChange={(e) => setUtmField(k, e.target.value)}
                    className="h-9"
                  />
                </div>
              ))}
            </div>
          </Collapsible>

          {/* Device targeting (deep links) */}
          <Collapsible
            icon={Smartphone}
            title="Device targeting"
            summary={
              deepCount > 0
                ? `${deepCount} platform${deepCount > 1 ? "s" : ""} routed`
                : "Open apps on mobile, web on desktop"
            }
            defaultOpen={deepCount > 0}
          >
            {(
              [
                {
                  label: "iOS",
                  sub: "iPhone & iPad",
                  Icon: AppleLogo,
                  chip: "bg-foreground/5 text-foreground",
                  value: iosUrl,
                  set: setIosUrl,
                  ph: "https://apps.apple.com/app/…",
                },
                {
                  label: "Android",
                  sub: "Phones & tablets",
                  Icon: AndroidLogo,
                  chip: "bg-emerald-500/10 text-emerald-600",
                  value: androidUrl,
                  set: setAndroidUrl,
                  ph: "https://play.google.com/store/apps/…",
                },
                {
                  label: "Desktop",
                  sub: "Windows · macOS · Linux",
                  Icon: Monitor,
                  chip: "bg-sky-500/10 text-sky-600",
                  value: desktopUrl,
                  set: setDesktopUrl,
                  ph: "https://example.com/desktop",
                },
              ] as const
            ).map((p) => {
              const routed = Boolean(p.value.trim());
              return (
                <div
                  key={p.label}
                  className={cn(
                    "rounded-xl border bg-background p-3 transition-colors",
                    routed && "border-foreground/15 ring-1 ring-foreground/5",
                  )}
                >
                  <div className="mb-2 flex items-center gap-2.5">
                    <span className={cn("flex size-8 items-center justify-center rounded-lg", p.chip)}>
                      <p.Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="text-sm font-medium">{p.label}</div>
                      <div className="text-[11px] text-muted-foreground">{p.sub}</div>
                    </div>
                    {routed ? (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                        <Check className="size-3" /> Routed
                      </span>
                    ) : (
                      <span className="shrink-0 text-[10px] text-muted-foreground">Uses default</span>
                    )}
                  </div>
                  <Input
                    type="url"
                    placeholder={p.ph}
                    value={p.value}
                    onChange={(e) => p.set(e.target.value)}
                    className="h-9"
                    aria-label={`${p.label} deep link URL`}
                    aria-invalid={Boolean(p.value.trim() && !isHttpUrl(p.value))}
                  />
                  {p.value.trim() && !isHttpUrl(p.value) && (
                    <p className="mt-1.5 text-[11px] text-red-600">
                      Must be a valid http(s) URL.
                    </p>
                  )}
                </div>
              );
            })}
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
              <Link2 className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Everyone else (and any platform left blank) goes to your destination above.
              </span>
            </div>
          </Collapsible>

          {/* Social preview */}
          <Collapsible
            icon={Share2}
            title="Social preview"
            summary={
              previewMode === "off"
                ? "No card — shares as a plain link"
                : previewMode === "destination"
                  ? "Pulled from the destination page"
                  : "Custom branded card"
            }
            defaultOpen={previewMode !== "off"}
          >
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {(
                [
                  ["off", "Off"],
                  ["destination", "From page"],
                  ["custom", "Custom"],
                ] as [PreviewMode, string][]
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPreviewMode(m)}
                  className={
                    previewMode === m
                      ? "flex-1 rounded-md bg-card px-2.5 py-1.5 text-xs font-medium shadow-sm"
                      : "flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {previewMode === "destination" && (
              <div className="space-y-2">
                <DestinationPreview
                  meta={destMeta}
                  loading={destLoading}
                  fallbackDomain={previewDomain}
                  fallbackImage={genDataUrl}
                />
                <p className="text-[11px] text-muted-foreground">
                  {destMeta && !destMeta.image ? (
                    <>
                      No image on <span className="font-medium">{previewDomain}</span> — we use your
                      branded card instead, shared under{" "}
                      <span className="font-medium">{shortHost}</span>.
                    </>
                  ) : (
                    <>
                      Auto-pulled from <span className="font-medium">{previewDomain}</span> but shared
                      under <span className="font-medium">{shortHost}</span> — your brand stays on the
                      card.
                    </>
                  )}
                </p>
              </div>
            )}

            {previewMode === "custom" && (
              <div className="space-y-3">
                <Input
                  placeholder="Preview title"
                  value={ogTitle}
                  onChange={(e) => setOgTitle(e.target.value)}
                  maxLength={120}
                />
                <textarea
                  placeholder="Preview description"
                  value={ogDescription}
                  onChange={(e) => setOgDescription(e.target.value)}
                  rows={2}
                  maxLength={300}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex gap-1 rounded-lg bg-muted p-1">
                  {(["generate", "upload"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setOgSource(s)}
                      className={cn(
                        "flex-1 rounded-md px-2.5 py-1 text-xs font-medium capitalize",
                        ogSource === s ? "bg-card shadow-sm" : "text-muted-foreground",
                      )}
                    >
                      {s === "generate" ? "Generate image" : "Upload image"}
                    </button>
                  ))}
                </div>
                {ogSource === "generate" ? (
                  <canvas ref={canvasRef} className="aspect-[1.91/1] w-full rounded-lg border" />
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <label className="cursor-pointer rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">
                        {ogImage ? "Replace image" : "Upload image"}
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => void pickOgImage(e.target.files?.[0])}
                        />
                      </label>
                      {ogImage && (
                        <button
                          type="button"
                          onClick={() => setOgImage("")}
                          className="text-sm text-muted-foreground hover:text-foreground"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {ogImage ? (
                      <img src={ogImage} alt="" className="aspect-[1.91/1] w-full rounded-lg border object-cover" />
                    ) : (
                      <div className="flex aspect-[1.91/1] w-full items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
                        Recommended 1200×630
                      </div>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {ogSource === "generate" ? (
                    <>
                      Auto-built from <span className="font-medium">{previewDomain}</span> and badged with{" "}
                      {config.ogLabel} — type above to override.
                    </>
                  ) : (
                    <>
                      Badged with <span className="font-medium">{config.ogLabel}</span> and shared under{" "}
                      <span className="font-medium">{shortHost}</span>.
                    </>
                  )}
                </p>
              </div>
            )}
          </Collapsible>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdvanced(true)}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed p-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <Plus className="size-4" /> Add UTM tracking, device routing & social card
        </button>
      )}
    </div>
  );
}
