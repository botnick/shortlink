import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useConfig } from "@/lib/config";
import type { SettingsDTO } from "@shared/types";

/** Loads the admin settings once and exposes a `patch` that PATCHes a slice,
 *  re-syncs the shared snapshot and (by default) refreshes the public config.
 *
 *  Each settings card owns its own draft state, seeded from this snapshot — so
 *  saving one card never resets another. The snapshot is also read live by the
 *  Social-card preview for its branding fallbacks (app name / colour), which is
 *  the one field dependency that crosses card boundaries. */
export function useSettingsData() {
  const { refresh: refreshConfig } = useConfig();
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<SettingsDTO>("/admin/settings")
      .then(setSettings)
      .catch(() => toast.error("Couldn't load settings"))
      .finally(() => setLoading(false));
  }, []);

  const patch = useCallback(
    async (
      body: Partial<SettingsDTO & { cfApiToken: string }>,
      opts?: { refreshConfig?: boolean },
    ) => {
      const updated = await api.patch<SettingsDTO>("/admin/settings", body);
      setSettings(updated);
      if (opts?.refreshConfig !== false) await refreshConfig();
      return updated;
    },
    [refreshConfig],
  );

  return { settings, loading, patch };
}

export type SettingsPatch = ReturnType<typeof useSettingsData>["patch"];
