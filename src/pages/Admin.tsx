import { useState } from "react";
import { BarChart3, Link2, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminOverview } from "@/pages/admin/AdminOverview";
import { AdminLinks } from "@/pages/admin/AdminLinks";
import { AdminTeam } from "@/pages/admin/AdminTeam";
import { AdminSettings } from "@/pages/admin/AdminSettings";

type Tab = "overview" | "links" | "team" | "settings";

const TABS: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "links", label: "Links", icon: Link2 },
  { id: "team", label: "Team", icon: Users },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Admin() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Monitor activity, manage every link and member, and configure the app.
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-lg border bg-card p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "overview" && <AdminOverview />}
      {tab === "links" && <AdminLinks />}
      {tab === "team" && <AdminTeam />}
      {tab === "settings" && <AdminSettings />}
    </div>
  );
}
