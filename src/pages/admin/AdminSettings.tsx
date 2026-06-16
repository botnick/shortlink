import { useSettingsData } from "./settings/useSettingsData";
import { RegistrationCard } from "./settings/RegistrationCard";
import { BrandingCard } from "./settings/BrandingCard";
import { BrandPagesCard } from "./settings/BrandPagesCard";
import { SocialCard } from "./settings/SocialCard";
import { LimitsCard } from "./settings/LimitsCard";
import { HumanCheckCard } from "./settings/HumanCheckCard";
import { CustomDomainsCard } from "./settings/CustomDomainsCard";

/** The admin settings tab. Loads the settings once, then renders each section as
 *  a self-contained card that owns its own draft state and save handler. See
 *  `settings/` for the per-card components. */
export function AdminSettings() {
  const { settings, loading, patch } = useSettingsData();
  const cardProps = { settings, loading, patch };
  return (
    <div className="space-y-6">
      <RegistrationCard {...cardProps} />
      <BrandingCard {...cardProps} />
      <BrandPagesCard {...cardProps} />
      <SocialCard {...cardProps} />
      <LimitsCard {...cardProps} />
      <HumanCheckCard {...cardProps} />
      <CustomDomainsCard {...cardProps} />
    </div>
  );
}
