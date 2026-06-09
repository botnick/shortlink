import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ConfigProvider, useConfig } from "@/lib/config";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/components/theme";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { Toaster } from "@/components/ui/sonner";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PageLoader } from "@/components/PageLoader";
import { Landing } from "@/pages/Landing";
import { Login } from "@/pages/Login";
import { Register } from "@/pages/Register";
import { Setup } from "@/pages/Setup";
import { NotFound } from "@/pages/NotFound";

// Code-split the heavier authenticated pages.
const Dashboard = lazy(() =>
  import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const LinkStats = lazy(() =>
  import("@/pages/LinkStats").then((m) => ({ default: m.LinkStats })),
);
const Admin = lazy(() =>
  import("@/pages/Admin").then((m) => ({ default: m.Admin })),
);
const QrPage = lazy(() =>
  import("@/pages/QrPage").then((m) => ({ default: m.QrPage })),
);
const Domains = lazy(() =>
  import("@/pages/Domains").then((m) => ({ default: m.Domains })),
);
const Terms = lazy(() => import("@/pages/Legal").then((m) => ({ default: m.Terms })));
const Privacy = lazy(() =>
  import("@/pages/Legal").then((m) => ({ default: m.Privacy })),
);
const QrLinkPage = lazy(() =>
  import("@/pages/QrLinkPage").then((m) => ({ default: m.QrLinkPage })),
);

function AppRoutes() {
  const { config, loading } = useConfig();
  if (loading) return <PageLoader />;

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<Layout />}>
          <Route
            path="/setup"
            element={
              config.needsSetup ? <Setup /> : <Navigate to="/login" replace />
            }
          />
          {config.needsSetup ? (
            <Route path="*" element={<Navigate to="/setup" replace />} />
          ) : (
            <>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              {/* Public standalone QR for any link (like lnk.ua/qr/<slug>). */}
              <Route path="/qr/:slug" element={<QrLinkPage />} />
              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/domains" element={<Domains />} />
                <Route path="/links/:id" element={<LinkStats />} />
                <Route path="/links/:id/qr" element={<QrPage />} />
              </Route>
              <Route element={<ProtectedRoute adminOnly />}>
                <Route path="/admin/*" element={<Admin />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </>
          )}
        </Route>
      </Routes>
    </Suspense>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <ConfigProvider>
        <AuthProvider>
          <ConfirmProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
            <Toaster />
          </ConfirmProvider>
        </AuthProvider>
      </ConfigProvider>
    </ThemeProvider>
  );
}
