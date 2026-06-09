import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useConfig } from "@/lib/config";
import { ApiError } from "@/lib/api";
import { HumanCheck, type HumanPayload } from "@/components/HumanCheck";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Logo } from "@/components/Logo";

export function Login() {
  const { user, loading, login } = useAuth();
  const { config } = useConfig();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Honeypot — invisible to humans; bots that fill it are rejected.
  const [website, setWebsite] = useState("");
  // Human check (invisible PoW or slider game, per admin setting).
  const checkOn = config.challengeMode !== "off";
  const [human, setHuman] = useState<HumanPayload | null>(null);
  const [hcNonce, setHcNonce] = useState(0);

  if (!loading && user) return <Navigate to="/dashboard" replace />;

  const canSubmit = !submitting && (!checkOn || human !== null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await login(email, password, { ...(human ?? {}), website });
      toast.success("Welcome back");
      navigate("/dashboard");
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 403 &&
        /verification/i.test(err.message)
      ) {
        // Challenge expired or was already used — mint a fresh one quietly.
        toast.error("Please try that check once more");
        setHuman(null);
        setHcNonce((n) => n + 1);
      } else {
        toast.error(err instanceof ApiError ? err.message : "Sign in failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-8">
      <div className="mb-6 flex justify-center">
        <Logo />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="display text-2xl">Sign in</CardTitle>
          <CardDescription>Welcome back. Enter your details.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            {/* Honeypot: hidden from humans (and screen readers); bots fill it. */}
            <input
              type="text"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="hidden"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
            />
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {checkOn && <HumanCheck nonce={hcNonce} onChange={setHuman} />}

            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {submitting && <Loader2 className="animate-spin" />}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link to="/register" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
