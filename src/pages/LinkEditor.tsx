import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import {
  Apple,
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Megaphone,
  Monitor,
  QrCode,
  Share2,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { compressUpload, ogToJpeg, ogToPng, renderOg, renderPhotoOg } from "@/lib/ogTemplates";
import { loadOgFont } from "@/lib/ogFonts";
import { composeFrame, makeDefault, renderQrSvg, svgDataUrl } from "@/lib/qr";
import type { LinkDTO, PreviewMode, UrlMetaDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfig, useShortHost } from "@/lib/config";
import { useProjects } from "@/lib/useProjects";

// --- UTM helpers ------------------------------------------------------------
const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;
type UtmKey = (typeof UTM_KEYS)[number];
type Utm = Record<UtmKey, string>;
const EMPTY_UTM: Utm = { source: "", medium: "", campaign: "", term: "", content: "" };

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function parseUtm(url: string): Utm {
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
function applyUtm(url: string, utm: Utm): string {
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

// --- Collapsible section (progressive disclosure, Rebrandly-style) ----------
function Collapsible({
  icon: Icon,
  title,
  summary,
  defaultOpen,
  children,
}: {
  icon: typeof Link2;
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="space-y-4 border-t bg-muted/20 p-4">{children}</div>}
    </section>
  );
}

/** Rich link-preview card as a platform unfurls our short link — source shown is
 *  us (short host + logo) with a "via <dest>" note; content from the destination. */
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

function CopyRow({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm" title={value}>
        {value}
      </span>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

/** Full-page link create/edit in Rebrandly's clean, progressive-disclosure style:
 *  a focused form (destination → short link → collapsible advanced sections) with
 *  a sticky preview rail (short link + QR). Our restraint, their friendliness. */
export function LinkEditor() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const shortHost = useShortHost();
  const { config } = useConfig();
  const { projects, selectedId, setSelectedId } = useProjects();

  const [loaded, setLoaded] = useState(!isEdit);
  const [link, setLink] = useState<LinkDTO | null>(null);
  const [destination, setDestination] = useState("");
  const [utm, setUtm] = useState<Utm>(EMPTY_UTM);
  const [alias, setAlias] = useState("");
  const [title, setTitle] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [iosUrl, setIosUrl] = useState("");
  const [androidUrl, setAndroidUrl] = useState("");
  const [desktopUrl, setDesktopUrl] = useState("");
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
  const ogAutoRef = useRef({ title: "", description: "" });
  const ogTemplate = config.ogTemplate;

  useEffect(() => {
    if (!isEdit || !id) return;
    let active = true;
    api
      .get<{ link: LinkDTO }>(`/links/${id}`)
      .then(({ link: l }) => {
        if (!active) return;
        setLink(l);
        setDestination(l.destination);
        setUtm(parseUtm(l.destination));
        setTitle(l.title ?? "");
        setIsActive(l.isActive);
        setIosUrl(l.iosUrl ?? "");
        setAndroidUrl(l.androidUrl ?? "");
        setDesktopUrl(l.desktopUrl ?? "");
        setPreviewMode(l.previewMode);
        setOgTitle(l.ogTitle ?? "");
        setOgDescription(l.ogDescription ?? "");
        setOgImage(l.ogImage ?? "");
        setOgSource(l.ogImage ? "upload" : "generate");
        setLoaded(true);
      })
      .catch(() => {
        toast.error("Couldn't load that link");
        navigate("/dashboard");
      });
    return () => {
      active = false;
    };
  }, [isEdit, id, navigate]);

  const destValid = isHttpUrl(destination);
  const previewDomain = (() => {
    try {
      return new URL(destination).hostname.replace(/^www\./, "");
    } catch {
      return shortHost;
    }
  })();
  const aliasOrSlug = link?.slug || alias.trim();
  const shortUrlText = `${shortHost}/${aliasOrSlug || "your-link"}`;
  const ogCardUrl = link?.shortUrl
    ? link.shortUrl.replace(/^https?:\/\//, "")
    : alias.trim()
      ? `${shortHost}/${alias.trim()}`
      : shortHost;

  const utmCount = Object.values(utm).filter((v) => v.trim()).length;
  const deepCount = [iosUrl, androidUrl, desktopUrl].filter((v) => v.trim()).length;

  // Compact "Link preview" shown in the rail — mirrors how the link unfurls.
  const pvTitle =
    previewMode === "custom"
      ? ogTitle.trim() || destMeta?.title || title.trim()
      : previewMode === "destination"
        ? destMeta?.title || ""
        : title.trim();
  const pvDesc =
    previewMode === "custom"
      ? ogDescription.trim()
      : previewMode === "destination"
        ? destMeta?.description || ""
        : "";
  const pvImage =
    previewMode === "custom" && ogSource === "upload"
      ? ogImage
      : previewMode === "destination"
        ? destMeta?.image || ""
        : "";

  function setUtmField(key: UtmKey, value: string) {
    const next = { ...utm, [key]: value };
    setUtm(next);
    const applied = applyUtm(destination, next);
    if (applied !== destination) setDestination(applied);
  }
  function onDestinationChange(value: string) {
    setDestination(value);
    setUtm(parseUtm(value));
  }

  // --- Social card rendering (same pipeline as before) ----------------------
  useEffect(() => {
    if (previewMode !== "custom" || ogSource !== "generate") return;
    let cancelled = false;
    void loadOgFont(config.ogFont).then((family) => {
      if (cancelled || !canvasRef.current) return;
      renderOg(canvasRef.current, {
        template: ogTemplate,
        font: family,
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
  }, [previewMode, ogSource, ogTemplate, config.ogFont, config.ogLabel, config.ogTitle, config.ogTagline, config.ogAccent, ogTitle, ogDescription, title, ogCardUrl, destMeta, brandLogo]);

  useEffect(() => {
    const wantMeta =
      previewMode === "destination" || (previewMode === "custom" && ogSource === "generate");
    if (!wantMeta || !isHttpUrl(destination)) {
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
        pTitle = pTitle || destMeta?.title?.trim() || null;
        pDesc = pDesc || destMeta?.description?.trim() || null;
      } else {
        image = ogImage.trim() || null;
      }
    }
    return { previewMode, ogTitle: pTitle, ogDescription: pDesc, ogImage: image };
  }

  async function brandUpload(rawDataUrl: string): Promise<string> {
    const [photo, family] = await Promise.all([
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = rawDataUrl;
      }),
      loadOgFont(config.ogFont),
    ]);
    const c = document.createElement("canvas");
    renderPhotoOg(c, {
      photo,
      font: family,
      appName: config.ogLabel,
      brandColor: config.ogAccent,
      logo: brandLogo,
    });
    return ogToJpeg(c);
  }
  async function pickOgImage(file: File | undefined) {
    if (!file) return;
    if (file.size > 10_000_000) {
      toast.error("Image is too large (max ~10MB)");
      return;
    }
    try {
      setOgImage(await brandUpload(await compressUpload(file)));
    } catch {
      toast.error("Couldn't read that image");
    }
  }

  function deepLinks() {
    return {
      iosUrl: iosUrl.trim() || null,
      androidUrl: androidUrl.trim() || null,
      desktopUrl: desktopUrl.trim() || null,
    };
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!destValid) {
      toast.error("Enter a valid http(s) destination URL");
      return;
    }
    for (const [label, v] of [
      ["iOS", iosUrl],
      ["Android", androidUrl],
      ["Desktop", desktopUrl],
    ] as const) {
      if (v.trim() && !isHttpUrl(v)) {
        toast.error(`${label} deep link must be a valid http(s) URL`);
        return;
      }
    }
    setSubmitting(true);
    try {
      if (isEdit && link) {
        await api.patch<{ link: LinkDTO }>(`/links/${link.id}`, {
          destination,
          title: title.trim() || null,
          isActive,
          ...deepLinks(),
          ...previewPayload(),
        });
        toast.success("Link updated");
      } else {
        await api.post<{ link: LinkDTO }>("/links", {
          destination,
          slug: alias.trim() || undefined,
          title: title.trim() || undefined,
          projectId: selectedId ?? undefined,
          ...deepLinks(),
          ...previewPayload(),
        });
        toast.success("Short link created");
      }
      navigate("/dashboard");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  const actions = (
    <>
      <Button type="button" variant="outline" onClick={() => navigate("/dashboard")}>
        Cancel
      </Button>
      <Button type="submit" disabled={submitting}>
        {submitting && <Loader2 className="animate-spin" />}
        {isEdit ? "Save changes" : "Create link"}
      </Button>
    </>
  );

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <header className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <RouterLink to="/dashboard" aria-label="Back to dashboard">
            <ArrowLeft />
          </RouterLink>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {isEdit ? "Edit branded link" : "Create a branded link & QR"}
          </h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            {isEdit
              ? "Update where it points and how it’s shared."
              : "One link with campaign tracking, device routing and a social card."}
          </p>
        </div>
        <div className="hidden items-center gap-2 lg:flex">{actions}</div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* ---- Main form ---- */}
        <div className="space-y-4">
          {/* Destination (hero) */}
          <section className="space-y-3 rounded-2xl border bg-card p-5">
            <Label htmlFor="destination" className="text-sm font-medium">
              Destination URL
            </Label>
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="destination"
                type="url"
                required
                autoFocus={!isEdit}
                placeholder="https://example.com/a/very/long/link"
                value={destination}
                onChange={(e) => onDestinationChange(e.target.value)}
                className="h-11 pl-9 text-base"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Where the short link sends people by default.
            </p>
          </section>

          {/* Short link */}
          <section className="space-y-4 rounded-2xl border bg-card p-5">
            {!isEdit && (
              <div className="space-y-2">
                <Label htmlFor="alias">
                  Custom back-half{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <div className="flex items-center overflow-hidden rounded-md border border-input bg-transparent text-sm focus-within:ring-2 focus-within:ring-ring">
                  <span className="whitespace-nowrap pl-3 text-muted-foreground">{shortHost}/</span>
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

            <div className="grid gap-4 sm:grid-cols-2">
              {!isEdit && projects.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="project">Project</Label>
                  <select
                    id="project"
                    value={selectedId ?? ""}
                    onChange={(e) => setSelectedId(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
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
          </section>

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
            <p className="text-[11px] text-muted-foreground">
              Send each platform somewhere specific (an app/universal link or store page). Blank =
              uses the destination above.
            </p>
            {(
              [
                ["iOS", iosUrl, setIosUrl, Apple, "https://apps.apple.com/app/…"],
                ["Android", androidUrl, setAndroidUrl, Smartphone, "https://play.google.com/store/apps/…"],
                ["Desktop", desktopUrl, setDesktopUrl, Monitor, "https://example.com/desktop"],
              ] as const
            ).map(([label, value, set, Icon, ph]) => (
              <div key={label} className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs">
                  <Icon className="size-3.5" /> {label}
                </Label>
                <Input type="url" placeholder={ph} value={value} onChange={(e) => set(e.target.value)} />
              </div>
            ))}
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
                <DestinationPreview meta={destMeta} loading={destLoading} fallbackDomain={previewDomain} />
                <p className="text-[11px] text-muted-foreground">
                  Auto-pulled from <span className="font-medium">{previewDomain}</span> but shared under{" "}
                  <span className="font-medium">{shortHost}</span> — your brand stays on the card.
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
        </div>

        {/* ---- Preview rail ---- */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:h-fit">
          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <span className="text-xs font-medium text-muted-foreground">Your short link</span>
            <CopyRow value={shortUrlText} label="Copy short link" />
            {destValid && (
              <p className="truncate text-[11px] text-muted-foreground" title={destination}>
                → {previewDomain}
              </p>
            )}
          </section>

          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <span className="text-xs font-medium text-muted-foreground">Link preview</span>
            <div className="overflow-hidden rounded-lg border">
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
                <div className="flex aspect-[1.91/1] w-full items-center justify-center border-b bg-muted/40 text-muted-foreground">
                  <Share2 className="size-5" />
                </div>
              )}
              <div className="space-y-0.5 p-2.5">
                <div className="truncate text-[11px] text-muted-foreground">{shortHost}</div>
                <div className="line-clamp-2 text-sm font-medium">{pvTitle || "No title yet"}</div>
                {pvDesc ? (
                  <div className="line-clamp-2 text-xs text-muted-foreground">{pvDesc}</div>
                ) : (
                  <div className="text-xs text-muted-foreground">No description</div>
                )}
              </div>
            </div>
          </section>

          {isEdit && link ? (
            <QrCard slug={link.slug} linkId={link.id} />
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
      </div>

      {/* Sticky action bar (mobile) */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-5 flex items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        {actions}
      </div>
    </form>
  );
}

/** QR block in the preview rail: a live QR plus its public /qr/<slug> share page. */
function QrCard({ slug, linkId }: { slug: string; linkId: string }) {
  const { config } = useConfig();
  const [svg, setSvg] = useState("");
  const qrUrl = `${window.location.origin}/qr/${slug}`;
  const shortUrl = `${window.location.origin}/${slug}`;

  useEffect(() => {
    let active = true;
    const cfg = makeDefault(config.brandColor);
    cfg.fg = "#0b0b0c";
    cfg.cornerSquareColor = config.brandColor;
    cfg.cornerDotColor = config.brandColor;
    renderQrSvg(cfg, shortUrl)
      .then((raw) => active && setSvg(composeFrame(raw, cfg).svg))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [shortUrl, config.brandColor]);

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
    </section>
  );
}
