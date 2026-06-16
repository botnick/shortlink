import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useShortHost } from "@/lib/config";
import { cn } from "@/lib/utils";
import { OG_TEMPLATES, renderOg } from "@/lib/ogTemplates";
import { OG_FONTS, loadOgFont } from "@/lib/ogFonts";
import { DEFAULT_APP_NAME } from "@shared/defaults";
import type { SettingsDTO } from "@shared/types";
import { ColorPicker } from "@/components/ColorPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsCard } from "./SettingsCard";
import type { SettingsPatch } from "./useSettingsData";

/** A live-rendered social-card template thumbnail (click to select). */
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

export function SocialCard({
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
      title="Social card"
      description={
        <>
          The branded preview image generated for links — shown when shared on X,
          Facebook, LINE and chat apps. Configured independently of branding;
          leave a field blank to inherit it.
        </>
      }
      loading={loading}
      skeleton={
        <div className="space-y-3">
          <Skeleton className="aspect-[1.91/1] w-full rounded-lg" />
          <Skeleton className="h-9 w-full" />
        </div>
      }
    >
      {settings && <SocialForm initial={settings} patch={patch} />}
    </SettingsCard>
  );
}

function SocialForm({ initial, patch }: { initial: SettingsDTO; patch: SettingsPatch }) {
  const shortHost = useShortHost();
  const [ogTemplate, setOgTemplate] = useState(initial.ogTemplate);
  const [ogFont, setOgFont] = useState(initial.ogFont);
  const [ogLabel, setOgLabel] = useState(initial.ogLabel);
  const [ogTitle, setOgTitle] = useState(initial.ogTitle);
  const [ogTagline, setOgTagline] = useState(initial.ogTagline);
  const [ogAccent, setOgAccent] = useState(initial.ogAccent);
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch({ ogTemplate, ogFont, ogLabel, ogTitle, ogTagline, ogAccent });
      toast.success("Social card saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  // Resolved social-card preview values (override → branding fallback → default).
  // The branding fallbacks read the live snapshot, so they update once the
  // Branding card's changes are saved.
  const cardLabel = ogLabel.trim() || initial.appName || DEFAULT_APP_NAME;
  const cardTitle = ogTitle.trim() || initial.appName || DEFAULT_APP_NAME;
  const cardTagline = ogTagline.trim() || initial.description;
  const cardAccent = /^#[0-9a-fA-F]{6}$/.test(ogAccent) ? ogAccent : initial.brandColor;
  const cardUrl = shortHost;

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="space-y-1.5">
        <Label>Preview</Label>
        {/* Compact hero preview — the full-bleed version was overpowering the
            card; the template grid below shows every option anyway. */}
        <div className="max-w-sm">
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
        </div>
      </div>

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
              <div className="text-center text-[11px] text-muted-foreground">{t.label}</div>
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
          <span className="font-normal text-muted-foreground">(wordmark on the card)</span>
        </Label>
        <Input
          id="ogLabel"
          value={ogLabel}
          placeholder={initial.appName || DEFAULT_APP_NAME}
          maxLength={40}
          onChange={(e) => setOgLabel(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ogTitle">
          Default headline{" "}
          <span className="font-normal text-muted-foreground">(when a link has no title)</span>
        </Label>
        <Input
          id="ogTitle"
          value={ogTitle}
          placeholder={initial.appName || DEFAULT_APP_NAME}
          maxLength={120}
          onChange={(e) => setOgTitle(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ogTagline">
          Tagline{" "}
          <span className="font-normal text-muted-foreground">(sub-line under the headline)</span>
        </Label>
        <Input
          id="ogTagline"
          value={ogTagline}
          placeholder={initial.description}
          maxLength={300}
          onChange={(e) => setOgTagline(e.target.value)}
        />
      </div>

      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Save
      </Button>
    </form>
  );
}
