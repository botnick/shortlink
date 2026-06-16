import { lazy, Suspense } from "react";
import { NavLink, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { BarChart3, Globe, Link2, LineChart, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageLoader } from "@/components/PageLoader";

// Code-split each admin tab so opening the console doesn't pull in all six
// (AdminSettings alone is large) — only the visited tab's chunk loads.
const AdminOverview = lazy(() =>
  import("@/pages/admin/AdminOverview").then((m) => ({ default: m.AdminOverview })),
);
const AdminAnalytics = lazy(() =>
  import("@/pages/admin/AdminAnalytics").then((m) => ({ default: m.AdminAnalytics })),
);
const AdminLinks = lazy(() =>
  import("@/pages/admin/AdminLinks").then((m) => ({ default: m.AdminLinks })),
);
const AdminTeam = lazy(() =>
  import("@/pages/admin/AdminTeam").then((m) => ({ default: m.AdminTeam })),
);
const AdminDomains = lazy(() =>
  import("@/pages/admin/AdminDomains").then((m) => ({ default: m.AdminDomains })),
);
const AdminSettings = lazy(() =>
  import("@/pages/admin/AdminSettings").then((m) => ({ default: m.AdminSettings })),
);

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

      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route index element={<AdminOverview />} />
          <Route path="analytics" element={<AdminAnalytics />} />
          <Route path="links" element={<AdminLinksRoute />} />
          <Route path="team" element={<AdminTeam />} />
          <Route path="domains" element={<AdminDomains />} />
          <Route path="settings" element={<AdminSettings />} />
        </Routes>
      </Suspense>
    </div>
  );
}
