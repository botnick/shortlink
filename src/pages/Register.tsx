import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Check, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useConfig } from "@/lib/config";
import { api, ApiError } from "@/lib/api";
import { solvePow } from "@/lib/pow";
import { cn } from "@/lib/utils";
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

/** 0–4: length and character variety. Deliberately simple and predictable. */
function passwordScore(pw: string): number {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) s++;
  return s;
}

const STRENGTH = [
  { label: "Too short", color: "bg-muted-foreground/30", text: "text-muted-foreground" },
  { label: "Weak", color: "bg-red-500", text: "text-red-600" },
  { label: "Okay", color: "bg-amber-500", text: "text-amber-600" },
  { label: "Good", color: "bg-emerald-500", text: "text-emerald-600" },
  { label: "Strong", color: "bg-emerald-600", text: "text-emerald-600" },
];

export function Register() {
  const { user, loading, register } = useAuth();
  const { config } = useConfig();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closed, setClosed] = useState(!config.registrationEnabled);
  // Honeypot — invisible to humans; bots that fill it are rejected.
  const [website, setWebsite] = useState("");

  // Invisible bot check: fetch a proof-of-work puzzle and solve it silently in
  // the background while the user types. No interaction, ever.
  const powOn = config.powDifficulty > 0;
  const [pow, setPow] = useState<{ challenge: string; solution: string } | null>(null);
  const [powState, setPowState] = useState<"idle" | "solving" | "ready">("idle");
  const powAbort = useRef<AbortController | null>(null);

  const startPow = useCallback(() => {
    if (!powOn) return;
    powAbort.current?.abort();
    const ctl = new AbortController();
    powAbort.current = ctl;
    setPow(null);
    setPowState("solving");
    api
      .get<{ challenge: string | null; difficulty: number }>("/auth/challenge")
      .then(async (r) => {
        if (!r.challenge || ctl.signal.aborted) {
          if (!r.challenge) setPowState("ready"); // turned off server-side
          return;
        }
        const solution = await solvePow(r.challenge, r.difficulty, ctl.signal);
        if (ctl.signal.aborted) return;
        setPow({ challenge: r.challenge, solution });
        setPowState("ready");
      })
      .catch(() => {
        // Network/abort — try once more on submit rather than blocking typing.
        if (!ctl.signal.aborted) setPowState("idle");
      });
  }, [powOn]);

  useEffect(() => {
    if (!closed) startPow();
    return () => powAbort.current?.abort();
  }, [closed, startPow]);

  if (!loading && user) return <Navigate to="/dashboard" replace />;

  const score = passwordScore(password);
  const strength = STRENGTH[score];
  const longEnough = password.length >= 8;
  const matches = confirm.length > 0 && password === confirm;
  const mismatch = confirm.length > 0 && password !== confirm;
  const powReady = !powOn || powState === "ready";
  const canSubmit =
    !submitting && longEnough && matches && email.trim().length > 0 && powReady;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await register(email, password, {
        ...(pow ?? {}),
        website,
      });
      toast.success("Account created");
      navigate("/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        if (/verification/i.test(err.message)) {
          // Challenge expired or was already used — mint a fresh one quietly.
          toast.error("Please try again in a moment");
          startPow();
        } else {
          setClosed(true);
        }
      } else {
        toast.error(err instanceof ApiError ? err.message : "Sign up failed");
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
          <CardTitle className="display text-2xl">Create account</CardTitle>
          <CardDescription>Start shortening links in seconds.</CardDescription>
        </CardHeader>
        <CardContent>
          {closed ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="inline-flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <LockKeyhole className="size-5" />
              </div>
              <p className="text-sm text-muted-foreground">
                Sign-ups are currently closed. Please check back later.
              </p>
            </div>
          ) : (
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
                  placeholder="you@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    title={showPw ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className={cn(
                            "h-1 flex-1 rounded-full bg-muted",
                            score >= i && strength.color,
                          )}
                        />
                      ))}
                    </div>
                    <p className={cn("text-xs", strength.text)}>
                      {strength.label}
                      {!longEnough && " — at least 8 characters"}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <div className="relative">
                  <Input
                    id="confirm"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="pr-10"
                  />
                  {confirm.length > 0 && (
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                      {matches ? (
                        <Check className="size-4 text-emerald-600" />
                      ) : (
                        <X className="size-4 text-red-500" />
                      )}
                    </span>
                  )}
                </div>
                {mismatch && (
                  <p className="text-xs text-red-600">Passwords don’t match.</p>
                )}
              </div>

              {powOn && (
                <p
                  className={cn(
                    "flex items-center justify-center gap-1.5 text-xs",
                    powState === "ready" ? "text-emerald-600" : "text-muted-foreground",
                  )}
                  aria-live="polite"
                >
                  {powState === "ready" ? (
                    <>
                      <ShieldCheck className="size-3.5" /> Browser verified
                    </>
                  ) : (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Checking your
                      browser…
                    </>
                  )}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={!canSubmit}>
                {submitting && <Loader2 className="animate-spin" />}
                Create account
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                By creating an account you agree to the{" "}
                <Link to="/terms" className="underline hover:text-foreground">
                  Terms
                </Link>{" "}
                and{" "}
                <Link to="/privacy" className="underline hover:text-foreground">
                  Privacy policy
                </Link>
                .
              </p>
            </form>
          )}
        </CardContent>
      </Card>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
