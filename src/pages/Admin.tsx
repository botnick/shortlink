import { NavLink, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { BarChart3, Globe, Link2, LineChart, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminOverview } from "@/pages/admin/AdminOverview";
import { AdminAnalytics } from "@/pages/admin/AdminAnalytics";
import { AdminLinks } from "@/pages/admin/AdminLinks";
import { AdminTeam } from "@/pages/admin/AdminTeam";
import { AdminDomains } from "@/pages/admin/AdminDomains";
import { AdminSettings } from "@/pages/admin/AdminSettings";

const TABS: { to: string; label: string; icon: typeof BarChart3; end?: boolean }[] = [
  { to: "/admin", label: "Overview", icon: BarChart3, end: true },
  { to: "/admin/analytics", label: "Analytics", icon: LineChart },
  { to: "/admin/links", label: "Links", icon: Link2 },
  { to: "/admin/team", label: "Team", icon: Users },
  { to: "/admin/domains", label: "Domains", icon: Globe },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

/** Links tab — reads an optional ?user filter (set from the Team tab) and remounts
 *  when it changes so the list reloads. */
function AdminLinksRoute() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const userId = params.get("user") || undefined;
  return (
    <AdminLinks
      key={userId ?? "all"}
      userId={userId}
      userLabel={params.get("email") || undefined}
      onClearFilter={() => navigate("/admin/links")}
    />
  );
}

export function Admin() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Monitor activity, manage every link and member, and configure the app.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg border bg-card p-1 sm:flex">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  "inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              <Icon className="size-4" />
              {t.label}
            </NavLink>
          );
        })}
      </div>

      <Routes>
        <Route index element={<AdminOverview />} />
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="links" element={<AdminLinksRoute />} />
        <Route path="team" element={<AdminTeam />} />
        <Route path="domains" element={<AdminDomains />} />
        <Route path="settings" element={<AdminSettings />} />
      </Routes>
    </div>
  );
}
