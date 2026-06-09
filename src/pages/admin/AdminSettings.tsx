import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { cn } from "@/lib/utils";
import { OG_TEMPLATES, renderOg } from "@/lib/ogTemplates";
import { OG_FONTS, loadOgFont } from "@/lib/ogFonts";
import { compressImage } from "@/lib/image";
import { ColorPicker } from "@/components/ColorPicker";
import {
  DEFAULT_APP_NAME,
  DEFAULT_BRAND_COLOR,
  DEFAULT_OG_FONT,
  DEFAULT_OG_TEMPLATE,
} from "@shared/defaults";
import type { SettingsDTO } from "@shared/types";

function TemplateThumb({
  template,
  fontId,
  brandColor,
  appName,
  title,
  description,
  url,
  selected,
  onSelect,
}: {
  template: string;
  fontId: string;
  brandColor: string;
  appName: string;
  title: string;
  description: string;
  url: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    void loadOgFont(fontId).then((family) => {
      if (cancelled || !ref.current) return;
      renderOg(ref.current, { template, font: family, title, description, appName, brandColor, url });
    });
    return () => {
      cancelled = true;
    };
  }, [template, fontId, brandColor, appName, title, description, url]);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "overflow-hidden rounded-lg border transition-all",
        selected ? "border-primary ring-2 ring-primary" : "hover:border-foreground/30",
      )}
    >
      <canvas ref={ref} className="block aspect-[1.91/1] w-full" />
    </button>
  );
}
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

function ImagePicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > 12_000_000) return toast.error("Image is too large (max ~12MB)");
    try {
      onChange(await compressImage(file));
    } catch {
      toast.error("Couldn't read that image");
    }
  }
  return (
    <div className="flex items-center gap-3">
      {value ? (
        <img src={value} alt="" className={className ?? "size-11 rounded-lg border object-contain p-1"} />
      ) : (
        <span className={`flex items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground ${className ?? "size-11"}`}>
          none
        </span>
      )}
      <label className="cursor-pointer rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">
        Upload
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {value && (
        <button type="button" onClick={() => onChange("")} className="text-sm text-muted-foreground hover:text-foreground">
          Remove
        </button>
      )}
    </div>
  );
}

export function AdminSettings() {
  const { refresh: refreshConfig } = useConfig();
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingReg, setSavingReg] = useState(false);
  const [savingApp, setSavingApp] = useState(false);

  const [appName, setAppName] = useState("");
  const [shortDomain, setShortDomain] = useState("");
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [ogImageUrl, setOgImageUrl] = useState("");
  const [indexable, setIndexable] = useState(true);

  // Social card — configured independently of branding (blank field = inherit).
  const [savingCard, setSavingCard] = useState(false);
  const [ogTemplate, setOgTemplate] = useState(DEFAULT_OG_TEMPLATE);
  const [ogFont, setOgFont] = useState(DEFAULT_OG_FONT);
  const [ogLabel, setOgLabel] = useState("");
  const [ogTitle, setOgTitle] = useState("");
  const [ogTagline, setOgTagline] = useState("");
  const [ogAccent, setOgAccent] = useState("");

  const [blockedDomains, setBlockedDomains] = useState("");
  const [extraReserved, setExtraReserved] = useState("");
  const [maxLinks, setMaxLinks] = useState(0);
  const [authRateLimit, setAuthRateLimit] = useState(10);
  const [createRateLimit, setCreateRateLimit] = useState(60);
  const [maxDomains, setMaxDomains] = useState(10);
  const [maxAliases, setMaxAliases] = useState(5);
  const [apiEnabled, setApiEnabled] = useState(true);
  const [apiRateLimit, setApiRateLimit] = useState(120);
  const [maxApiKeys, setMaxApiKeys] = useState(10);
  const [slugLength, setSlugLength] = useState(6);
  const [savingLimits, setSavingLimits] = useState(false);

  const [cfToken, setCfToken] = useState("");
  const [cfZoneId, setCfZoneId] = useState("");
  const [cfFallbackHost, setCfFallbackHost] = useState("");
  const [unverifiedDays, setUnverifiedDays] = useState(90);
  const [cfConfigured, setCfConfigured] = useState(false);
  const [savingCf, setSavingCf] = useState(false);

  useEffect(() => {
    api
      .get<SettingsDTO>("/admin/settings")
      .then((s) => {
        setSettings(s);
        setAppName(s.appName);
        setShortDomain(s.shortDomain);
        setBrandColor(s.brandColor);
        setLogoUrl(s.logoUrl);
        setDescription(s.description);
        setOgImageUrl(s.ogImageUrl);
        setIndexable(s.indexable);
        setOgTemplate(s.ogTemplate);
        setOgFont(s.ogFont);
        setOgLabel(s.ogLabel);
        setOgTitle(s.ogTitle);
        setOgTagline(s.ogTagline);
        setOgAccent(s.ogAccent);
        setBlockedDomains(s.blockedDomains.join("\n"));
        setExtraReserved(s.extraReserved.join("\n"));
        setMaxLinks(s.maxLinksPerUser);
        setAuthRateLimit(s.authRateLimit);
        setCreateRateLimit(s.createRateLimit);
        setMaxDomains(s.maxDomainsPerUser);
        setMaxAliases(s.maxAliasesPerLink);
        // Guard with defaults so a stale/older payload can't silently flip these.
        setApiEnabled(s.apiEnabled ?? true);
        setApiRateLimit(s.apiRateLimit ?? 120);
        setMaxApiKeys(s.maxApiKeysPerUser ?? 10);
        setSlugLength(s.slugLength ?? 6);
        setCfZoneId(s.cfZoneId);
        setCfFallbackHost(s.cfFallbackHost);
        setUnverifiedDays(s.domainUnverifiedDays);
        setCfConfigured(s.cfConfigured);
      })
      .catch(() => toast.error("Couldn't load settings"))
      .finally(() => setLoading(false));
  }, []);

  async function patch(body: Partial<SettingsDTO>) {
    const updated = await api.patch<SettingsDTO>("/admin/settings", body);
    setSettings(updated);
    await refreshConfig();
  }

  async function toggleRegistration(value: boolean) {
    setSavingReg(true);
    try {
      await patch({ registrationEnabled: value });
      toast.success(value ? "Registration opened" : "Registration closed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSavingReg(false);
    }
  }

  async function saveApp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavingApp(true);
    try {
      await patch({ appName, shortDomain, brandColor, logoUrl, description, ogImageUrl, indexable });
      toast.success("Branding saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSavingApp(false);
    }
  }

  const toLines = (s: string) =>
    s.split("\n").map((x) => x.trim()).filter(Boolean);

  async function saveLimits(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavingLimits(true);
    try {
      await patch({
        blockedDomains: toLines(blockedDomains),
        extraReserved: toLines(extraReserved),
        maxLinksPerUser: Math.max(0, Math.floor(maxLinks) || 0),
        authRateLimit: Math.max(0, Math.floor(authRateLimit) || 0),
        createRateLimit: Math.max(0, Math.floor(createRateLimit) || 0),
        maxDomainsPerUser: Math.max(0, Math.floor(maxDomains) || 0),
        maxAliasesPerLink: Math.max(0, Math.floor(maxAliases) || 0),
        apiEnabled,
        apiRateLimit: Math.max(0, Math.floor(apiRateLimit) || 0),
        maxApiKeysPerUser: Math.max(0, Math.floor(maxApiKeys) || 0),
        slugLength: Math.min(32, Math.max(3, Math.floor(slugLength) || 6)),
      });
      toast.success("Limits saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSavingLimits(false);
    }
  }

  async function saveCf(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavingCf(true);
    try {
      const body: Partial<SettingsDTO & { cfApiToken: string }> = {
        cfZoneId,
        cfFallbackHost,
        domainUnverifiedDays: unverifiedDays,
      };
      if (cfToken.trim()) body.cfApiToken = cfToken.trim();
      const updated = await api.patch<SettingsDTO>("/admin/settings", body);
      setSettings(updated);
      setCfConfigured(updated.cfConfigured);
      setCfToken("");
      toast.success("Custom domain settings saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSavingCf(false);
    }
  }

  async function saveCard(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavingCard(true);
    try {
      await patch({ ogTemplate, ogFont, ogLabel, ogTitle, ogTagline, ogAccent });
      toast.success("Social card saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSavingCard(false);
    }
  }

  // Resolved social-card preview values (override → branding fallback → default).
  const cardLabel = ogLabel.trim() || appName || DEFAULT_APP_NAME;
  const cardTitle = ogTitle.trim() || appName || DEFAULT_APP_NAME;
  const cardTagline = ogTagline.trim() || description;
  const cardAccent = /^#[0-9a-fA-F]{6}$/.test(ogAccent) ? ogAccent : brandColor;
  const cardUrl = shortDomain.trim() || window.location.host;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registration</CardTitle>
          <CardDescription>When closed, new accounts can’t be created.</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span className="text-sm">
              {settings?.registrationEnabled ? "Sign-ups are open" : "Sign-ups are closed"}
            </span>
            {loading || !settings ? (
              <Skeleton className="h-5 w-9 rounded-full" />
            ) : (
              <Switch checked={settings.registrationEnabled} disabled={savingReg} onCheckedChange={toggleRegistration} />
            )}
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Branding &amp; SEO</CardTitle>
          <CardDescription>Shown across the app, on short links and in social shares.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <form onSubmit={saveApp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="appName">App name</Label>
                <Input id="appName" required maxLength={40} value={appName} onChange={(e) => setAppName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shortDomain">Short domain</Label>
                <Input id="shortDomain" placeholder="links.example.com" value={shortDomain} onChange={(e) => setShortDomain(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="brandColor">Brand color</Label>
                <ColorPicker value={brandColor} onChange={setBrandColor} />
              </div>
              <div className="space-y-2">
                <Label>Logo</Label>
                <ImagePicker value={logoUrl} onChange={setLogoUrl} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">
                  Description <span className="font-normal text-muted-foreground">(search &amp; social)</span>
                </Label>
                <textarea
                  id="desc"
                  rows={2}
                  maxLength={300}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A fast, clean URL shortener with analytics."
                  className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-2">
                <Label>Social share image <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <ImagePicker value={ogImageUrl} onChange={setOgImageUrl} className="h-11 w-20 rounded-lg border object-cover" />
              </div>
              <label className="flex cursor-pointer items-center justify-between gap-4">
                <span className="text-sm">Allow search engines to index</span>
                <Switch checked={indexable} onCheckedChange={setIndexable} />
              </label>

              <Button type="submit" disabled={savingApp}>
                {savingApp && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Social card</CardTitle>
          <CardDescription>
            The branded preview image generated for links — shown when shared on X,
            Facebook, LINE and chat apps. Configured independently of branding;
            leave a field blank to inherit it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="aspect-[1.91/1] w-full rounded-lg" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <form onSubmit={saveCard} className="space-y-5">
              <TemplateThumb
                template={ogTemplate}
                fontId={ogFont}
                brandColor={cardAccent}
                appName={cardLabel}
                title={cardTitle}
                description={cardTagline}
                url={cardUrl}
                selected
                onSelect={() => {}}
              />

              <div className="space-y-2">
                <Label>Template</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {OG_TEMPLATES.map((t) => (
                    <div key={t.id} className="space-y-1">
                      <TemplateThumb
                        template={t.id}
                        fontId={ogFont}
                        brandColor={cardAccent}
                        appName={cardLabel}
                        title={cardTitle}
                        description={cardTagline}
                        url={cardUrl}
                        selected={ogTemplate === t.id}
                        onSelect={() => setOgTemplate(t.id)}
                      />
                      <div className="text-center text-[11px] text-muted-foreground">
                        {t.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ogFont">Font</Label>
                  <select
                    id="ogFont"
                    value={ogFont}
                    onChange={(e) => setOgFont(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {OG_FONTS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ogAccent">Accent color</Label>
                  <div className="flex items-center gap-2">
                    <ColorPicker value={cardAccent} onChange={setOgAccent} />
                    {ogAccent && (
                      <button
                        type="button"
                        onClick={() => setOgAccent("")}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Inherit brand
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ogLabel">
                  Brand label{" "}
                  <span className="font-normal text-muted-foreground">
                    (wordmark on the card)
                  </span>
                </Label>
                <Input
                  id="ogLabel"
                  value={ogLabel}
                  placeholder={appName || DEFAULT_APP_NAME}
                  maxLength={40}
                  onChange={(e) => setOgLabel(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ogTitle">
                  Default headline{" "}
                  <span className="font-normal text-muted-foreground">
                    (when a link has no title)
                  </span>
                </Label>
                <Input
                  id="ogTitle"
                  value={ogTitle}
                  placeholder={appName || DEFAULT_APP_NAME}
                  maxLength={120}
                  onChange={(e) => setOgTitle(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ogTagline">
                  Tagline{" "}
                  <span className="font-normal text-muted-foreground">
                    (sub-line under the headline)
                  </span>
                </Label>
                <Input
                  id="ogTagline"
                  value={ogTagline}
                  placeholder={description}
                  maxLength={300}
                  onChange={(e) => setOgTagline(e.target.value)}
                />
              </div>

              <Button type="submit" disabled={savingCard}>
                {savingCard && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Limits &amp; safety</CardTitle>
          <CardDescription>Guardrails applied when members create links.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <form onSubmit={saveLimits} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="blocked">
                  Blocked destination domains{" "}
                  <span className="font-normal text-muted-foreground">(one per line)</span>
                </Label>
                <textarea
                  id="blocked"
                  rows={3}
                  value={blockedDomains}
                  onChange={(e) => setBlockedDomains(e.target.value)}
                  placeholder={"malware.example\nspam.test"}
                  className="w-full rounded-lg border bg-transparent px-3 py-2 font-mono text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  Links pointing to these domains (or their subdomains) are rejected.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reserved">
                  Reserved aliases{" "}
                  <span className="font-normal text-muted-foreground">(one per line)</span>
                </Label>
                <textarea
                  id="reserved"
                  rows={3}
                  value={extraReserved}
                  onChange={(e) => setExtraReserved(e.target.value)}
                  placeholder={"pricing\nblog"}
                  className="w-full rounded-lg border bg-transparent px-3 py-2 font-mono text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxLinks">
                  Max links per member{" "}
                  <span className="font-normal text-muted-foreground">(0 = unlimited)</span>
                </Label>
                <Input
                  id="maxLinks"
                  type="number"
                  min={0}
                  value={maxLinks}
                  onChange={(e) => setMaxLinks(Number(e.target.value))}
                  className="max-w-[12rem]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slugLength">
                  Random back-half length{" "}
                  <span className="font-normal text-muted-foreground">(3–32)</span>
                </Label>
                <Input
                  id="slugLength"
                  type="number"
                  min={3}
                  max={32}
                  value={slugLength}
                  onChange={(e) => setSlugLength(Number(e.target.value))}
                  className="max-w-[12rem]"
                />
                <p className="text-[11px] text-muted-foreground">
                  Used for auto-generated links (no custom back-half), imports and the
                  editor’s “Shortest” suggestion.
                </p>
              </div>

              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-medium">Abuse limits</p>
                <p className="-mt-2 text-xs text-muted-foreground">
                  Guardrails against spam and brute force. 0 turns a limit off.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="maxAliases">Back-half changes per link</Label>
                    <Input
                      id="maxAliases"
                      type="number"
                      min={0}
                      value={maxAliases}
                      onChange={(e) => setMaxAliases(Number(e.target.value))}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Old back-halves keep working; this caps how many times one link
                      can change.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="maxDomains">Custom domains per member</Label>
                    <Input
                      id="maxDomains"
                      type="number"
                      min={0}
                      value={maxDomains}
                      onChange={(e) => setMaxDomains(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="authRate">Login attempts / 15 min / IP</Label>
                    <Input
                      id="authRate"
                      type="number"
                      min={0}
                      value={authRateLimit}
                      onChange={(e) => setAuthRateLimit(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="createRate">New links / hour / member</Label>
                    <Input
                      id="createRate"
                      type="number"
                      min={0}
                      value={createRateLimit}
                      onChange={(e) => setCreateRateLimit(Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Public API</p>
                    <p className="text-xs text-muted-foreground">
                      Programmatic access with bearer API keys (/api/v1).
                    </p>
                  </div>
                  <Switch
                    checked={apiEnabled}
                    onCheckedChange={setApiEnabled}
                    aria-label="Enable the public API"
                  />
                </div>
                {apiEnabled && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="apiRate">Requests / minute / key</Label>
                      <Input
                        id="apiRate"
                        type="number"
                        min={0}
                        value={apiRateLimit}
                        onChange={(e) => setApiRateLimit(Number(e.target.value))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="maxKeys">API keys per member</Label>
                      <Input
                        id="maxKeys"
                        type="number"
                        min={0}
                        value={maxApiKeys}
                        onChange={(e) => setMaxApiKeys(Number(e.target.value))}
                      />
                    </div>
                  </div>
                )}
              </div>

              <Button type="submit" disabled={savingLimits}>
                {savingLimits && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom domains</CardTitle>
          <CardDescription>
            Optional. Add Cloudflare for SaaS credentials and members’ domains connect
            automatically (CNAME + TLS). Leave blank for free DNS-verify only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <form onSubmit={saveCf} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cfToken">
                  Cloudflare API token{" "}
                  {cfConfigured && (
                    <span className="font-normal text-emerald-600">· configured</span>
                  )}
                </Label>
                <Input
                  id="cfToken"
                  type="password"
                  value={cfToken}
                  onChange={(e) => setCfToken(e.target.value)}
                  placeholder={cfConfigured ? "•••••••• (leave blank to keep)" : "Token with SSL & Certificates: Edit"}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cfZone">Zone ID</Label>
                <Input id="cfZone" value={cfZoneId} onChange={(e) => setCfZoneId(e.target.value)} placeholder="your Cloudflare zone id" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cfFallback">
                  Fallback host{" "}
                  <span className="font-normal text-muted-foreground">(optional — members CNAME to this)</span>
                </Label>
                <Input id="cfFallback" value={cfFallbackHost} onChange={(e) => setCfFallbackHost(e.target.value)} placeholder="defaults to this app's domain" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unverifiedDays">Auto-remove unverified domains</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="unverifiedDays"
                    type="number"
                    min={0}
                    max={3650}
                    value={unverifiedDays}
                    onChange={(e) =>
                      setUnverifiedDays(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                    }
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">
                    days after they're added (0 = never)
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Members see a countdown on the domain before it's removed.
                </p>
              </div>
              <Button type="submit" disabled={savingCf}>
                {savingCf && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
