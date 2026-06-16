import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { DEFAULT_BRAND_COPY } from "@shared/defaults";
import type { BrandCopy, SettingsDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsCard } from "./SettingsCard";
import type { SettingsPatch } from "./useSettingsData";

/** The branded error/status pages, in the order shown in the admin form. */
const BRAND_ERROR_KINDS: { key: keyof BrandCopy["errors"]; label: string; code: string }[] = [
  { key: "not-found", label: "Not found", code: "404" },
  { key: "expired", label: "Expired", code: "410" },
  { key: "disabled", label: "Disabled", code: "410" },
  { key: "rate-limited", label: "Rate limited", code: "429" },
  { key: "error", label: "Server error", code: "500" },
];

const BRAND_TEXTAREA =
  "w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function BrandPagesCard({
  settings,
  loading,
  patch,
}: {
  settings: SettingsDTO | null;
  loading: boolean;
  patch: SettingsPatch;
}) {
  return (
    <SettingsCard
      title="Brand pages"
      description={
        <>
          The no-JS pages a visitor can hit on a short link (404, expired, password
          unlock, …). Every field is optional — blank falls back to the default.
        </>
      }
      loading={loading}
    >
      {settings && <BrandPagesForm initial={settings} patch={patch} />}
    </SettingsCard>
  );
}

function BrandPagesForm({ initial, patch }: { initial: SettingsDTO; patch: SettingsPatch }) {
  const [brandCopy, setBrandCopy] = useState<BrandCopy>(initial.brandCopy ?? DEFAULT_BRAND_COPY);
  const [safetyInterstitial, setSafetyInterstitial] = useState(initial.safetyInterstitial);
  const [saving, setSaving] = useState(false);

  // Immutable nested updates for the brand-copy object.
  const setErr = (k: keyof BrandCopy["errors"], f: "heading" | "sub", v: string) =>
    setBrandCopy((p) => ({ ...p, errors: { ...p.errors, [k]: { ...p.errors[k], [f]: v } } }));
  const setPw = (f: keyof BrandCopy["password"], v: string) =>
    setBrandCopy((p) => ({ ...p, password: { ...p.password, [f]: v } }));
  const setIt = (f: keyof BrandCopy["interstitial"], v: string) =>
    setBrandCopy((p) => ({ ...p, interstitial: { ...p.interstitial, [f]: v } }));
  const setSup = (f: keyof BrandCopy["support"], v: string) =>
    setBrandCopy((p) => ({ ...p, support: { ...p.support, [f]: v } }));

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      // Re-sync from the server's resolved copy: cleared fields come back as
      // their defaults, so the form snaps back instead of staying blank.
      const u = await patch({ brandCopy, safetyInterstitial });
      setBrandCopy(u.brandCopy);
      setSafetyInterstitial(u.safetyInterstitial);
      toast.success("Brand pages saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span>
          <span className="block text-sm font-medium">Safety interstitial</span>
          <span className="block text-xs text-muted-foreground">
            Confirm “you’re leaving to …” before forwarding to the destination.
          </span>
        </span>
        <Switch checked={safetyInterstitial} onCheckedChange={setSafetyInterstitial} />
      </label>

      <div className="space-y-4 border-t pt-5">
        <p className="text-sm font-medium">Status pages</p>
        {BRAND_ERROR_KINDS.map(({ key, label, code }) => (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                {code}
              </span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <Input
              maxLength={120}
              placeholder="Heading"
              value={brandCopy.errors[key].heading}
              onChange={(e) => setErr(key, "heading", e.target.value)}
            />
            <textarea
              rows={2}
              maxLength={400}
              placeholder="Supporting line"
              value={brandCopy.errors[key].sub}
              onChange={(e) => setErr(key, "sub", e.target.value)}
              className={BRAND_TEXTAREA}
            />
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t pt-5">
        <p className="text-sm font-medium">Password unlock</p>
        <Input maxLength={120} placeholder="Heading" value={brandCopy.password.heading} onChange={(e) => setPw("heading", e.target.value)} />
        <textarea rows={2} maxLength={400} placeholder="Supporting line" value={brandCopy.password.sub} onChange={(e) => setPw("sub", e.target.value)} className={BRAND_TEXTAREA} />
        <div className="grid grid-cols-2 gap-2">
          <Input maxLength={60} placeholder="Field label" value={brandCopy.password.label} onChange={(e) => setPw("label", e.target.value)} />
          <Input maxLength={60} placeholder="Button" value={brandCopy.password.button} onChange={(e) => setPw("button", e.target.value)} />
        </div>
      </div>

      <div className="space-y-2 border-t pt-5">
        <p className="text-sm font-medium">Interstitial</p>
        <Input maxLength={120} placeholder="Heading" value={brandCopy.interstitial.heading} onChange={(e) => setIt("heading", e.target.value)} />
        <textarea rows={2} maxLength={400} placeholder="Supporting line" value={brandCopy.interstitial.sub} onChange={(e) => setIt("sub", e.target.value)} className={BRAND_TEXTAREA} />
        <div className="grid grid-cols-2 gap-2">
          <Input maxLength={120} placeholder="“Leaving to” line" value={brandCopy.interstitial.leaving} onChange={(e) => setIt("leaving", e.target.value)} />
          <Input maxLength={60} placeholder="Continue button" value={brandCopy.interstitial.continue} onChange={(e) => setIt("continue", e.target.value)} />
        </div>
      </div>

      <div className="space-y-2 border-t pt-5">
        <p className="text-sm font-medium">Shared</p>
        <Input maxLength={60} placeholder="“Go to homepage” button" value={brandCopy.homeCta} onChange={(e) => setBrandCopy((p) => ({ ...p, homeCta: e.target.value }))} />
        <div className="grid grid-cols-2 gap-2">
          <Input maxLength={60} placeholder="Support label" value={brandCopy.support.label} onChange={(e) => setSup("label", e.target.value)} />
          <Input type="url" maxLength={2048} placeholder="Support URL (optional)" value={brandCopy.support.url} onChange={(e) => setSup("url", e.target.value)} />
        </div>
      </div>

      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Save
      </Button>
    </form>
  );
}
