import { useState } from "react";
import { BarChart3, Globe, Link2, LineChart, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminUserDTO } from "@shared/types";
import { AdminOverview } from "@/pages/admin/AdminOverview";
import { AdminAnalytics } from "@/pages/admin/AdminAnalytics";
import { AdminLinks } from "@/pages/admin/AdminLinks";
import { AdminTeam } from "@/pages/admin/AdminTeam";
import { AdminDomains } from "@/pages/admin/AdminDomains";
import { AdminSettings } from "@/pages/admin/AdminSettings";

type Tab = "overview" | "analytics" | "links" | "team" | "domains" | "settings";

const TABS: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "analytics", label: "Analytics", icon: LineChart },
  { id: "links", label: "Links", icon: Link2 },
  { id: "team", label: "Team", icon: Users },
  { id: "domains", label: "Domains", icon: Globe },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Admin() {
  const [tab, setTab] = useState<Tab>("overview");
  const [focusUser, setFocusUser] = useState<AdminUserDTO | null>(null);

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
      {tab === "analytics" && <AdminAnalytics />}
      {tab === "links" && (
        <AdminLinks
          key={focusUser?.id ?? "all"}
          userId={focusUser?.id}
          userLabel={focusUser?.email}
          onClearFilter={() => setFocusUser(null)}
        />
      )}
      {tab === "team" && (
        <AdminTeam
          onViewLinks={(u) => {
            setFocusUser(u);
            setTab("links");
          }}
        />
      )}
      {tab === "domains" && <AdminDomains />}
      {tab === "settings" && <AdminSettings />}
    </div>
  );
}
