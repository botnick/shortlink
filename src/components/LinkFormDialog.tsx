import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { OG_TEMPLATES, ogDataUrl, renderOg } from "@/lib/ogTemplates";
import type { LinkDTO, PreviewMode } from "@shared/types";
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
}

export function LinkFormDialog({ open, onOpenChange, link, onSaved }: Props) {
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
  const [ogTemplate, setOgTemplate] = useState("minimal");
  const [submitting, setSubmitting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
      setOgTemplate("minimal");
    }
  }, [open, link]);

  // Re-draw the generated card whenever its inputs change.
  useEffect(() => {
    if (previewMode === "custom" && ogSource === "generate" && canvasRef.current) {
      renderOg(canvasRef.current, {
        template: ogTemplate,
        title: ogTitle || title,
        appName: config.appName,
        brandColor: config.brandColor,
      });
    }
  }, [previewMode, ogSource, ogTemplate, ogTitle, title, config.appName, config.brandColor, open]);

  function previewPayload() {
    let image: string | null = null;
    if (previewMode === "custom") {
      image =
        ogSource === "generate" && canvasRef.current
          ? ogDataUrl(canvasRef.current)
          : ogImage.trim() || null;
    }
    return {
      previewMode,
      ogTitle: previewMode === "custom" ? ogTitle.trim() || null : null,
      ogDescription: previewMode === "custom" ? ogDescription.trim() || null : null,
      ogImage: image,
    };
  }

  function pickOgImage(file: File | undefined) {
    if (!file) return;
    if (file.size > 300_000) return toast.error("Keep the image under ~300KB");
    const reader = new FileReader();
    reader.onload = () => setOgImage(String(reader.result));
    reader.readAsDataURL(file);
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
              <p className="text-xs text-muted-foreground">
                We’ll show the destination page’s own title, description and image.
              </p>
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
                  <>
                    <div className="grid grid-cols-3 gap-1.5">
                      {OG_TEMPLATES.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setOgTemplate(t.id)}
                          className={cn(
                            "rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                            ogTemplate === t.id
                              ? "border-primary bg-primary/5"
                              : "hover:bg-accent",
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <canvas
                      ref={canvasRef}
                      className="aspect-[1.91/1] w-full rounded-lg border"
                    />
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <label className="cursor-pointer rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">
                        {ogImage ? "Replace image" : "Upload image"}
                        <input type="file" accept="image/*" className="sr-only" onChange={(e) => pickOgImage(e.target.files?.[0])} />
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
                  Shared as <span className="font-medium">{previewDomain}</span> — title
                  and description appear under the image.
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
