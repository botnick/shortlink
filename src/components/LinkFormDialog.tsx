import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { compressUpload, ogToPng, renderOg } from "@/lib/ogTemplates";
import { loadOgFont } from "@/lib/ogFonts";
import type { LinkDTO, PreviewMode, UrlMetaDTO } from "@shared/types";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useConfig, useShortHost } from "@/lib/config";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  link?: LinkDTO | null;
  onSaved: (link: LinkDTO) => void;
  /** Project to create the link in (create mode). */
  projectId?: string;
}

/** Rich link-preview card as a platform actually unfurls our short link: the
 *  title/description/image come from the destination, but the source shown is
 *  *us* (our short host + logo via og:url/og:site_name) with a "via <dest>" note. */
function DestinationPreview({
  meta,
  loading,
  fallbackDomain,
}: {
  meta: UrlMetaDTO | null;
  loading: boolean;
  fallbackDomain: string;
}) {
  const shortHost = useShortHost();
  const { config } = useConfig();
  const source = meta?.domain || fallbackDomain;
  const hide = (e: { currentTarget: HTMLImageElement }) => {
    e.currentTarget.style.display = "none";
  };
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {meta?.image ? (
        <img
          src={meta.image}
          alt=""
          className="aspect-[1.91/1] w-full border-b object-cover"
          onError={hide}
        />
      ) : null}
      <div className="flex items-start gap-3 p-3">
        {config.logoUrl ? (
          <img src={config.logoUrl} alt="" className="mt-0.5 size-5 rounded" onError={hide} />
        ) : (
          <div
            className="mt-0.5 size-5 shrink-0 rounded"
            style={{ backgroundColor: config.brandColor }}
          />
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
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {meta.description}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function LinkFormDialog({ open, onOpenChange, link, onSaved, projectId }: Props) {
  const isEdit = Boolean(link);
  const shortHost = useShortHost();
  const { config } = useConfig();
  const [destination, setDestination] = useState("");
  const [alias, setAlias] = useState("");
  const [title, setTitle] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("off");
  const [ogTitle, setOgTitle] = useState("");
  const [ogDescription, setOgDescription] = useState("");
  const [ogImage, setOgImage] = useState("");
  const [ogSource, setOgSource] = useState<"generate" | "upload">("generate");
  const [submitting, setSubmitting] = useState(false);
  const [destMeta, setDestMeta] = useState<UrlMetaDTO | null>(null);
  const [destLoading, setDestLoading] = useState(false);
  const [brandLogo, setBrandLogo] = useState<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The last title/description we auto-filled from the destination — so a fresh
  // fetch can refresh an untouched field but never overwrite what the user typed.
  const ogAutoRef = useRef({ title: "", description: "" });
  const ogTemplate = config.ogTemplate; // system default, set by admin
  // Short URL shown on the generated card (its own link once saved, else a preview).
  const ogCardUrl = link?.shortUrl
    ? link.shortUrl.replace(/^https?:\/\//, "")
    : alias.trim()
      ? `${shortHost}/${alias.trim()}`
      : shortHost;

  useEffect(() => {
    if (open) {
      setDestination(link?.destination ?? "");
      setAlias("");
      setTitle(link?.title ?? "");
      setIsActive(link?.isActive ?? true);
      setPreviewMode(link?.previewMode ?? "off");
      setOgTitle(link?.ogTitle ?? "");
      setOgDescription(link?.ogDescription ?? "");
      setOgImage(link?.ogImage ?? "");
      setOgSource(link?.ogImage ? "upload" : "generate");
      ogAutoRef.current = { title: "", description: "" };
    }
  }, [open, link]);

  // Re-draw the generated card whenever its inputs (or the system font) change.
  useEffect(() => {
    if (previewMode !== "custom" || ogSource !== "generate") return;
    let cancelled = false;
    void loadOgFont(config.ogFont).then((family) => {
      if (cancelled || !canvasRef.current) return;
      renderOg(canvasRef.current, {
        template: ogTemplate,
        font: family,
        // Auto-pull the destination's title/description; a value the user typed
        // always wins. renderOg truncates anything over-long for us.
        title: ogTitle.trim() || destMeta?.title?.trim() || title.trim() || config.ogTitle,
        description: ogDescription.trim() || destMeta?.description?.trim() || config.ogTagline,
        appName: config.ogLabel,
        brandColor: config.ogAccent,
        url: ogCardUrl,
        logo: brandLogo,
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode, ogSource, ogTemplate, config.ogFont, config.ogLabel, config.ogTitle, config.ogTagline, config.ogAccent, ogTitle, ogDescription, title, ogCardUrl, destMeta, brandLogo, open]);

  // Fetch the destination's own metadata (debounced) so we can auto-fill the card:
  // "From page" mode renders it directly; "Custom → Generate" pulls the title/desc
  // into our branded template with zero clicks. Skip it for uploads / Off.
  useEffect(() => {
    const wantMeta =
      previewMode === "destination" ||
      (previewMode === "custom" && ogSource === "generate");
    if (!wantMeta || !/^https?:\/\//i.test(destination.trim())) {
      setDestMeta(null);
      return;
    }
    let active = true;
    setDestLoading(true);
    const t = setTimeout(async () => {
      try {
        const { meta } = await api.get<{ meta: UrlMetaDTO }>(
          `/links/meta?url=${encodeURIComponent(destination.trim())}`,
        );
        if (!active) return;
        setDestMeta(meta);
        // Mirror the pulled values into the editable fields so the user sees (and
        // can tweak) exactly what's on the card. Only fill a field that's empty or
        // still holds our previous auto-fill — never clobber a manual edit.
        if (previewMode === "custom" && ogSource === "generate") {
          setOgTitle((cur) => {
            if (cur.trim() && cur !== ogAutoRef.current.title) return cur;
            const next = (meta.title ?? "").trim().slice(0, 120);
            ogAutoRef.current.title = next;
            return next;
          });
          setOgDescription((cur) => {
            if (cur.trim() && cur !== ogAutoRef.current.description) return cur;
            const next = (meta.description ?? "").trim().slice(0, 300);
            ogAutoRef.current.description = next;
            return next;
          });
        }
      } catch {
        if (active) setDestMeta(null);
      } finally {
        if (active) setDestLoading(false);
      }
    }, 600);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [previewMode, ogSource, destination]);

  // Load the site logo once so the generated card can embed our brand. crossOrigin
  // keeps the canvas exportable; if the logo host blocks CORS the load just errors
  // out to null (the card falls back to the accent bar) — never taints the canvas.
  useEffect(() => {
    const src = config.logoUrl?.trim();
    if (!src) {
      setBrandLogo(null);
      return;
    }
    let active = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => active && setBrandLogo(img);
    img.onerror = () => active && setBrandLogo(null);
    img.src = src;
    return () => {
      active = false;
    };
  }, [config.logoUrl]);

  function previewPayload() {
    let image: string | null = null;
    let pTitle = previewMode === "custom" ? ogTitle.trim() || null : null;
    let pDesc = previewMode === "custom" ? ogDescription.trim() || null : null;
    if (previewMode === "custom") {
      if (ogSource === "generate" && canvasRef.current) {
        image = ogToPng(canvasRef.current);
        // Keep the og:title/description text in step with what we drew on the card
        // (auto-pulled from the destination whenever the user left them blank).
        pTitle = pTitle || destMeta?.title?.trim() || null;
        pDesc = pDesc || destMeta?.description?.trim() || null;
      } else {
        image = ogImage.trim() || null;
      }
    }
    return { previewMode, ogTitle: pTitle, ogDescription: pDesc, ogImage: image };
  }

  async function pickOgImage(file: File | undefined) {
    if (!file) return;
    if (file.size > 10_000_000) {
      toast.error("Image is too large (max ~10MB)");
      return;
    }
    // Downscale + re-encode to JPEG so the stored image stays small and sharp.
    try {
      setOgImage(await compressUpload(file));
    } catch {
      toast.error("Couldn't read that image");
    }
  }

  const previewDomain = (() => {
    try {
      return new URL(destination).hostname.replace(/^www\./, "");
    } catch {
      return shortHost;
    }
  })();

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (isEdit && link) {
        const { link: updated } = await api.patch<{ link: LinkDTO }>(
          `/links/${link.id}`,
          { destination, title: title.trim() || null, isActive, ...previewPayload() },
        );
        toast.success("Link updated");
        onSaved(updated);
      } else {
        const { link: created } = await api.post<{ link: LinkDTO }>("/links", {
          destination,
          slug: alias.trim() || undefined,
          title: title.trim() || undefined,
          projectId,
          ...previewPayload(),
        });
        toast.success("Short link created");
        onSaved(created);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit link" : "Create short link"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update where this short link points."
              : "Shorten a long URL. Optionally pick a custom alias."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="destination">Destination URL</Label>
            <Input
              id="destination"
              type="url"
              required
              autoFocus
              placeholder="https://example.com/a/very/long/link"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </div>

          {!isEdit && (
            <div className="space-y-2">
              <Label htmlFor="alias">
                Custom alias{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <div className="flex items-center overflow-hidden rounded-md border border-input bg-transparent text-sm focus-within:ring-2 focus-within:ring-ring">
                <span className="whitespace-nowrap pl-3 text-muted-foreground">
                  {shortHost}/
                </span>
                <input
                  id="alias"
                  className="h-9 w-full bg-transparent px-1 text-base outline-none md:text-sm"
                  placeholder="my-link"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="title">
              Title{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="title"
              placeholder="Spring campaign"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {isEdit && (
            <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3">
              <span>
                <span className="block text-sm font-medium">Active</span>
                <span className="block text-xs text-muted-foreground">
                  Inactive links stop redirecting.
                </span>
              </span>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </label>
          )}

          <div className="space-y-2">
            <Label>
              Social preview{" "}
              <span className="font-normal text-muted-foreground">
                (card shown when shared)
              </span>
            </Label>
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
                />
                <p className="text-[11px] text-muted-foreground">
                  Auto-pulled from <span className="font-medium">{previewDomain}</span>{" "}
                  but shared under <span className="font-medium">{shortHost}</span> — your
                  brand stays on the card.
                </p>
              </div>
            )}
            {previewMode === "custom" && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
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
                  className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  <canvas
                    ref={canvasRef}
                    className="aspect-[1.91/1] w-full rounded-lg border"
                  />
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <label className="cursor-pointer rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">
                        {ogImage ? "Replace image" : "Upload image"}
                        <input type="file" accept="image/*" className="sr-only" onChange={(e) => void pickOgImage(e.target.files?.[0])} />
                      </label>
                      {ogImage && (
                        <button type="button" onClick={() => setOgImage("")} className="text-sm text-muted-foreground hover:text-foreground">
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
                      Auto-built from{" "}
                      <span className="font-medium">{previewDomain}</span> and badged
                      with {config.ogLabel} — type above to override the title or
                      description.
                    </>
                  ) : (
                    <>
                      Shared as <span className="font-medium">{previewDomain}</span> —
                      title and description appear under the image.
                    </>
                  )}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" />}
              {isEdit ? "Save changes" : "Create link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
