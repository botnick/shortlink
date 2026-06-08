import { Link, Navigate } from "react-router-dom";
import { ArrowRight, BarChart3, QrCode, ShieldCheck, Zap } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useConfig } from "@/lib/config";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: Zap,
    title: "Edge-fast redirects",
    body: "Links resolve from a global edge cache, so they’re fast wherever your visitors are.",
  },
  {
    icon: BarChart3,
    title: "Real analytics",
    body: "Clicks, unique visitors, countries, referrers and devices — in a clean dashboard.",
  },
  {
    icon: QrCode,
    title: "QR codes",
    body: "A customizable QR for every link. Download a crisp PNG or vector SVG.",
  },
  {
    icon: ShieldCheck,
    title: "Private & secure",
    body: "Account-gated, hardened sessions, and visitor IPs are hashed — never stored raw.",
  },
];

export function Landing() {
  const { user, loading } = useAuth();
  const { config } = useConfig();
  if (!loading && user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-16 py-6 sm:space-y-24 sm:py-12">
      <section className="mx-auto max-w-2xl text-center">
        <h1 className="display text-balance text-4xl sm:text-5xl">
          Short links, backed by real numbers.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-muted-foreground sm:text-lg">
          {config.appName} turns long URLs into short, trackable links — with a QR
          code for every one. Create an account to get started.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/register">
              Get started <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-4xl">
        <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-card p-6 sm:p-7">
              <Icon className="size-5 text-primary" strokeWidth={2} />
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
