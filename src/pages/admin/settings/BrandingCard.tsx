import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { compressImage } from "@/lib/image";
import { ColorPicker } from "@/components/ColorPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsCard } from "./SettingsCard";
import type { SettingsDTO } from "@shared/types";
import type { SettingsPatch } from "./useSettingsData";

/** Logo / social-image picker: upload (compressed client-side) or remove. */
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

export function BrandingCard({
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
      title="Branding & SEO"
      description="Shown across the app, on short links and in social shares."
      loading={loading}
    >
      {settings && <BrandingForm initial={settings} patch={patch} />}
    </SettingsCard>
  );
}

function BrandingForm({ initial, patch }: { initial: SettingsDTO; patch: SettingsPatch }) {
  const [appName, setAppName] = useState(initial.appName);
  const [brandColor, setBrandColor] = useState(initial.brandColor);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [description, setDescription] = useState(initial.description);
  const [ogImageUrl, setOgImageUrl] = useState(initial.ogImageUrl);
  const [indexable, setIndexable] = useState(initial.indexable);
  const [twitterHandle, setTwitterHandle] = useState(initial.twitterHandle);
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch({ appName, brandColor, logoUrl, description, ogImageUrl, indexable, twitterHandle });
      toast.success("Branding saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="appName">App name</Label>
        <Input id="appName" required maxLength={40} value={appName} onChange={(e) => setAppName(e.target.value)} />
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
      <div className="space-y-2">
        <Label htmlFor="twitterHandle">
          X / Twitter handle <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="twitterHandle"
          maxLength={16}
          value={twitterHandle}
          onChange={(e) => setTwitterHandle(e.target.value)}
          placeholder="@acme"
        />
      </div>
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="text-sm">Allow search engines to index</span>
        <Switch checked={indexable} onCheckedChange={setIndexable} />
      </label>

      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Save
      </Button>
    </form>
  );
}
