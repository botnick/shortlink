import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { compressUpload, ogToJpeg, ogToPng, renderOg, renderPhotoOg } from "@/lib/ogTemplates";
import { loadOgFont } from "@/lib/ogFonts";
import { useConfig, useShortHost } from "@/lib/config";
import { useProjects } from "@/lib/useProjects";
import {
  applyUtm,
  EMPTY_UTM,
  isHttpUrl,
  parseUtm,
  randomSlug,
  SLUG_OPTIONS,
  slugWords,
  suggestSource,
  toSlug,
  type SlugKind,
  type Utm,
  type UtmKey,
} from "@/lib/linkForm";
import type {
  DomainDTO,
  DomainListDTO,
  LinkAliasDTO,
  LinkAliasListDTO,
  LinkDTO,
  PreviewMode,
  UrlMetaDTO,
} from "@shared/types";

/** All of the link editor's state, effects, derived values and handlers. Pulled
 *  out of the (formerly 1500-line) component so the view is just JSX wiring.
 *  Kept as a hook rather than a reducer because the fields interdepend
 *  (destination ↔ UTM, slug ↔ domain availability) and this preserves the exact
 *  original behaviour. */
export function useLinkEditorForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const shortHost = useShortHost();
  const { config } = useConfig();
  // Links are created into the project already selected on the dashboard
  // (persisted in localStorage) — no need to pick it again here.
  const { selectedId, selected } = useProjects();

  const [loaded, setLoaded] = useState(!isEdit);
  const [link, setLink] = useState<LinkDTO | null>(null);
  const [destination, setDestination] = useState("");
  const [utm, setUtm] = useState<Utm>(EMPTY_UTM);
  const [alias, setAlias] = useState("");
  // The custom domain the back-half lives on (null = the default short host).
  const [domainId, setDomainId] = useState<string | null>(null);
  const [domains, setDomains] = useState<DomainDTO[]>([]);
  // Retired back-halves that still redirect here (edit history).
  const [aliases, setAliases] = useState<LinkAliasDTO[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [iosUrl, setIosUrl] = useState("");
  const [androidUrl, setAndroidUrl] = useState("");
  const [desktopUrl, setDesktopUrl] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("off");
  const [ogTitle, setOgTitle] = useState("");
  const [ogDescription, setOgDescription] = useState("");
  const [ogImage, setOgImage] = useState("");
  const [ogSource, setOgSource] = useState<"generate" | "upload">("generate");
  const [genDataUrl, setGenDataUrl] = useState(""); // live snapshot of the generated card
  const [submitting, setSubmitting] = useState(false);
  // Synchronous re-entry guard: the `submitting` state disables the button a
  // render late, so an Enter-key repeat or double-click could fire two saves.
  const submittingRef = useRef(false);
  const [showAdvanced, setShowAdvanced] = useState(isEdit); // create starts simple
  const [slugStrategy, setSlugStrategy] = useState(""); // last "Optimize" label used
  const [slugStatus, setSlugStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "reserved"
  >("idle");
  const [passwordOn, setPasswordOn] = useState(false);
  const [password, setPassword] = useState("");
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
        setAlias(l.slug);
        setDomainId(l.domainId);
        setIsActive(l.isActive);
        setTags(l.tags ?? []);
        setIosUrl(l.iosUrl ?? "");
        setAndroidUrl(l.androidUrl ?? "");
        setDesktopUrl(l.desktopUrl ?? "");
        setPreviewMode(l.previewMode);
        setOgTitle(l.ogTitle ?? "");
        setOgDescription(l.ogDescription ?? "");
        setOgImage(l.ogImage ?? "");
        setOgSource(l.ogImage ? "upload" : "generate");
        setPasswordOn(l.hasPassword);
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

  // Domains the user can host a back-half on (ownership confirmed → usable).
  useEffect(() => {
    let active = true;
    api
      .get<DomainListDTO>("/domains")
      .then((r) => {
        if (active)
          setDomains(
            r.domains.filter((d) => d.status === "verified" || d.status === "active"),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // On create, start new links on the selected project's default domain.
  const projectDomainApplied = useRef(false);
  useEffect(() => {
    if (isEdit || projectDomainApplied.current || !selected) return;
    projectDomainApplied.current = true;
    if (selected.defaultDomainId) setDomainId(selected.defaultDomainId);
  }, [isEdit, selected]);

  // Retired back-halves (history). Refetched after a back-half change saves.
  function loadAliases() {
    if (!isEdit || !id) return;
    api
      .get<LinkAliasListDTO>(`/links/${id}/aliases`)
      .then((r) => setAliases(r.aliases))
      .catch(() => {});
  }
  useEffect(() => {
    if (!isEdit || !id) return;
    let active = true;
    api
      .get<LinkAliasListDTO>(`/links/${id}/aliases`)
      .then((r) => active && setAliases(r.aliases))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isEdit, id]);

  const destValid = isHttpUrl(destination);
  const previewDomain = (() => {
    try {
      return new URL(destination).hostname.replace(/^www\./, "");
    } catch {
      return shortHost;
    }
  })();
  // The host the short link lives on: the chosen custom domain, or the default.
  const selectedDomain = domains.find((d) => d.id === domainId) ?? null;
  const selectedHost = selectedDomain?.hostname ?? shortHost;
  const aliasOrSlug = alias.trim() || link?.slug || "";
  const shortUrlText = `${selectedHost}/${aliasOrSlug || "your-link"}`;
  const ogCardUrl = `${selectedHost}/${aliasOrSlug || "your-link"}`;

  const utmCount = Object.values(utm).filter((v) => v.trim()).length;
  const deepCount = [iosUrl, androidUrl, desktopUrl].filter((v) => v.trim()).length;
  // "Suggested" slugs need real words from the destination (its page title if we
  // pulled it, else its host + path); without them only the random options apply.
  const slugSource = suggestSource(destination, destMeta?.title || undefined);
  const hasSlugSource = slugWords(slugSource).length > 0;

  // Compact "Link preview" shown in the rail — mirrors how the link unfurls.
  const pvTitle =
    previewMode === "custom"
      ? ogTitle.trim() || destMeta?.title || ""
      : previewMode === "destination"
        ? destMeta?.title || ""
        : "";
  const pvDesc =
    previewMode === "custom"
      ? ogDescription.trim()
      : previewMode === "destination"
        ? destMeta?.description || ""
        : "";
  const pvImage =
    previewMode === "custom"
      ? ogSource === "upload"
        ? ogImage
        : genDataUrl
      : previewMode === "destination"
        ? destMeta?.image || genDataUrl // fall back to our branded card
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
  // Friendly: when the user pastes a bare domain, add https:// for them on blur.
  function normalizeDestination() {
    const v = destination.trim();
    if (v && !/^https?:\/\//i.test(v) && /^[\w-]+(\.[\w-]+)+/.test(v)) {
      onDestinationChange(`https://${v}`);
    }
  }
  // Random lengths follow the admin-configured default (config.slugLength).
  const shortLen = Math.min(32, Math.max(3, config.slugLength));
  const longLen = Math.min(32, shortLen + 2);
  function optimizeSlug(kind: SlugKind) {
    setSlugStrategy(SLUG_OPTIONS.find((o) => o.kind === kind)?.label ?? "");
    if (kind === "shortest") return setAlias(randomSlug(shortLen));
    if (kind === "random") return setAlias(randomSlug(longLen));
    const s = toSlug(slugSource, kind);
    setAlias(s.length >= 3 ? s : (s + randomSlug(4)).slice(0, 32));
  }

  // --- Social card rendering (same pipeline as before) ----------------------
  useEffect(() => {
    // Render our branded card for Custom→Generate (to the visible canvas) and,
    // as a fallback, for From-page (offscreen) — used when the destination has
    // no image of its own. Either way the snapshot lands in genDataUrl.
    const wantCard =
      (previewMode === "custom" && ogSource === "generate") || previewMode === "destination";
    if (!wantCard) return;
    let cancelled = false;
    void loadOgFont(config.ogFont).then((family) => {
      if (cancelled) return;
      const visible = previewMode === "custom" && ogSource === "generate";
      const canvas = visible ? canvasRef.current : document.createElement("canvas");
      if (!canvas) return;
      renderOg(canvas, {
        template: ogTemplate,
        font: family,
        title: ogTitle.trim() || destMeta?.title?.trim() || config.ogTitle,
        description: ogDescription.trim() || destMeta?.description?.trim() || config.ogTagline,
        appName: config.ogLabel,
        brandColor: config.ogAccent,
        url: ogCardUrl,
        logo: brandLogo,
      });
      setGenDataUrl(canvas.toDataURL("image/png"));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode, ogSource, ogTemplate, config.ogFont, config.ogLabel, config.ogTitle, config.ogTagline, config.ogAccent, ogTitle, ogDescription, ogCardUrl, destMeta, brandLogo]);

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

  // Live back-half availability, scoped to the chosen domain. The link's own
  // current (slug, domain) is always available to itself, so skip that case.
  useEffect(() => {
    const s = alias.trim();
    if (isEdit && link && s === link.slug && domainId === link.domainId) {
      setSlugStatus("idle");
      return;
    }
    if (!s || !/^[a-zA-Z0-9_-]{3,32}$/.test(s)) {
      setSlugStatus("idle");
      return;
    }
    let active = true;
    setSlugStatus("checking");
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ slug: s });
        if (domainId) params.set("domainId", domainId);
        const r = await api.get<{ available: boolean; reason?: string }>(
          `/links/slug-check?${params}`,
        );
        if (!active) return;
        setSlugStatus(r.available ? "available" : r.reason === "reserved" ? "reserved" : "taken");
      } catch {
        if (active) setSlugStatus("idle");
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [alias, domainId, isEdit, link]);

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
    } else if (previewMode === "destination") {
      // From-page: if the destination has its own image the worker pulls it live
      // (null here); if it has none, store our branded card as the fallback so
      // the shared card still looks designed, not bare.
      image = destMeta?.image ? null : genDataUrl || null;
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
  function passwordField() {
    // On: set the typed password, else (edit) keep the existing one. Off: clear
    // an existing password, else there's nothing to send.
    if (passwordOn) return password.trim() ? { password } : {};
    return link?.hasPassword ? { password: null } : {};
  }

  function addTag(raw: string) {
    const t = raw.trim().slice(0, 40);
    if (!t) return;
    setTags((prev) => (prev.includes(t) || prev.length >= 20 ? prev : [...prev, t]));
    setTagInput("");
  }
  function commitPendingTag() {
    if (tagInput.trim()) addTag(tagInput);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return; // a save is already in flight
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
    if (passwordOn && !password.trim() && !(isEdit && link?.hasPassword)) {
      toast.error("Enter a password, or turn off password protection");
      return;
    }
    const aliasTrim = alias.trim();
    if (isEdit && !aliasTrim) {
      toast.error("The back-half can’t be empty");
      return;
    }
    if (aliasTrim && !/^[a-zA-Z0-9_-]{3,32}$/.test(aliasTrim)) {
      toast.error("Back-half: 3–32 characters — letters, numbers, - or _");
      return;
    }
    if (slugStatus === "taken" || slugStatus === "reserved") {
      toast.error("That back-half isn’t available — try another");
      return;
    }
    // Don't save against an unresolved availability check.
    if (slugStatus === "checking") {
      toast.error("Hold on — still checking that back-half");
      return;
    }
    // Fold a typed-but-not-committed tag into the set being saved.
    const effectiveTags = tagInput.trim()
      ? Array.from(new Set([...tags, tagInput.trim().slice(0, 40)])).slice(0, 20)
      : tags;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (isEdit && link) {
        // Diff against what's saved and PATCH only the fields that changed —
        // no point re-sending an unchanged destination or a heavy social image.
        const candidate: Record<string, unknown> = {
          destination,
          slug: aliasTrim,
          domainId,
          isActive,
          ...deepLinks(),
          ...previewPayload(),
        };
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(candidate)) {
          if (v !== ((link as unknown as Record<string, unknown>)[k] ?? null)) patch[k] = v;
        }
        // Tags are an array — compare by value, not reference.
        if (JSON.stringify(effectiveTags) !== JSON.stringify(link.tags ?? []))
          patch.tags = effectiveTags;
        Object.assign(patch, passwordField()); // already only set when changed
        if (Object.keys(patch).length === 0) {
          toast.success("No changes to save");
          return;
        }
        const { link: updated } = await api.patch<{ link: LinkDTO }>(
          `/links/${link.id}`,
          patch,
        );
        // Stay on the page; refresh the baseline so the next save diffs cleanly.
        setLink(updated);
        setIsActive(updated.isActive);
        loadAliases(); // a back-half change may have added to the history
        toast.success("Changes saved");
      } else {
        const { link: created } = await api.post<{ link: LinkDTO }>("/links", {
          destination,
          slug: aliasTrim || undefined,
          domainId: domainId ?? undefined,
          projectId: selectedId ?? undefined,
          tags: effectiveTags,
          ...deepLinks(),
          ...passwordField(),
          ...previewPayload(),
        });
        toast.success("Short link created");
        // Drop into the new link's editor (QR, stats, more edits) instead of
        // bouncing back to the dashboard.
        navigate(`/dashboard/links/${created.id}/edit`);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return {
    // routing / context
    isEdit,
    navigate,
    shortHost,
    config,
    selected,
    // primitives + setters
    loaded,
    link,
    destination,
    utm,
    alias,
    setAlias,
    domainId,
    setDomainId,
    domains,
    aliases,
    isActive,
    setIsActive,
    tags,
    setTags,
    tagInput,
    setTagInput,
    iosUrl,
    setIosUrl,
    androidUrl,
    setAndroidUrl,
    desktopUrl,
    setDesktopUrl,
    previewMode,
    setPreviewMode,
    ogTitle,
    setOgTitle,
    ogDescription,
    setOgDescription,
    ogImage,
    setOgImage,
    ogSource,
    setOgSource,
    submitting,
    showAdvanced,
    setShowAdvanced,
    slugStrategy,
    setSlugStrategy,
    slugStatus,
    passwordOn,
    setPasswordOn,
    password,
    setPassword,
    destMeta,
    destLoading,
    canvasRef,
    // derived
    destValid,
    previewDomain,
    selectedHost,
    aliasOrSlug,
    shortUrlText,
    utmCount,
    deepCount,
    hasSlugSource,
    genDataUrl,
    pvTitle,
    pvDesc,
    pvImage,
    shortLen,
    longLen,
    // handlers
    setUtmField,
    onDestinationChange,
    normalizeDestination,
    optimizeSlug,
    pickOgImage,
    addTag,
    commitPendingTag,
    handleSubmit,
  };
}

export type LinkEditorForm = ReturnType<typeof useLinkEditorForm>;
