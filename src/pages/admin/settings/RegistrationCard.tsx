import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsCard } from "./SettingsCard";
import type { SettingsDTO } from "@shared/types";
import type { SettingsPatch } from "./useSettingsData";

/** Registration master switch. Unlike the other cards it has no draft form —
 *  the toggle writes through immediately — so it reads the live snapshot. */
export function RegistrationCard({
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
      await patch({ registrationEnabled: value });
      toast.success(value ? "Registration opened" : "Registration closed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard
      title="Registration"
      description="When closed, new accounts can’t be created."
      loading={false}
    >
      <label className="flex cursor-pointer items-center justify-between gap-4">
        <span className="text-sm">
          {settings?.registrationEnabled ? "Sign-ups are open" : "Sign-ups are closed"}
        </span>
        {loading || !settings ? (
          <Skeleton className="h-5 w-9 rounded-full" />
        ) : (
          <Switch
            checked={settings.registrationEnabled}
            disabled={saving}
            onCheckedChange={toggle}
          />
        )}
      </label>
    </SettingsCard>
  );
}
