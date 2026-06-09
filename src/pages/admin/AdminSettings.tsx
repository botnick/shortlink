import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useConfig } from "@/lib/config";
import type { SettingsDTO } from "@shared/types";
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
  function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > 300_000) return toast.error("Keep the image under ~300KB");
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
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
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
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
  const [brandColor, setBrandColor] = useState("#e5392e");
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [ogImageUrl, setOgImageUrl] = useState("");
  const [indexable, setIndexable] = useState(true);

  const [blockedDomains, setBlockedDomains] = useState("");
  const [extraReserved, setExtraReserved] = useState("");
  const [maxLinks, setMaxLinks] = useState(0);
  const [savingLimits, setSavingLimits] = useState(false);

  const [cfToken, setCfToken] = useState("");
  const [cfZoneId, setCfZoneId] = useState("");
  const [cfFallbackHost, setCfFallbackHost] = useState("");
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
        setBlockedDomains(s.blockedDomains.join("\n"));
        setExtraReserved(s.extraReserved.join("\n"));
        setMaxLinks(s.maxLinksPerUser);
        setCfZoneId(s.cfZoneId);
        setCfFallbackHost(s.cfFallbackHost);
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
                <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5">
                  <span className="size-5 rounded border" style={{ backgroundColor: brandColor }} />
                  <span className="text-sm text-muted-foreground">{brandColor}</span>
                  <input id="brandColor" type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="sr-only" />
                </label>
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
