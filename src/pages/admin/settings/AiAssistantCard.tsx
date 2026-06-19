import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsCard } from "./SettingsCard";
import type { SettingsDTO } from "@shared/types";
import type { SettingsPatch } from "./useSettingsData";

/** Master switch for the opt-in AI link assistant. Writes through immediately,
 *  like the Registration toggle. (Daily + per-user caps are enforced server-side
 *  to keep it on the Workers AI free tier regardless.) */
export function AiAssistantCard({
  settings,
  loading,
  patch,
}: {
  settings: SettingsDTO | null;
  loading: boolean;
  patch: SettingsPatch;
}) {
  const [saving, setSaving] = useState(false);

  async function toggle(value: boolean) {
    setSaving(true);
    try {
      await patch({ aiAssistantEnabled: value }, { refreshConfig: false });
      toast.success(value ? "AI assistant enabled" : "AI assistant disabled");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      title="AI link assistant"
      description="Lets members suggest a slug and social-card title/description from the destination page. Opt-in, rate-limited and capped to the Workers AI free tier; the offline optimizer is used whenever it's off or unavailable."
      loading={false}
    >
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="text-sm">
          {settings?.aiAssistantEnabled ? "AI suggestions on" : "AI suggestions off"}
        </span>
        {loading || !settings ? (
          <Skeleton className="h-5 w-9 rounded-full" />
        ) : (
          <Switch
            checked={settings.aiAssistantEnabled}
            disabled={saving}
            onCheckedChange={toggle}
          />
        )}
      </label>
    </SettingsCard>
  );
}
