import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import type { UserDTO } from "@shared/types";
import { DEFAULT_APP_NAME, DEFAULT_BRAND_COLOR } from "@shared/defaults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BrandMark } from "@/components/Logo";
import { ColorPicker } from "@/components/ColorPicker";

export function Setup() {
  const navigate = useNavigate();
  const { refresh: refreshConfig } = useConfig();
  const { refresh: refreshAuth } = useAuth();

  const [token, setToken] = useState("");
  const [appName, setAppName] = useState(DEFAULT_APP_NAME);
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous guard so a double-submit can't fire two setup POSTs (the second
  // would hit the one-shot claim and surface a misleading "already completed").
  const submittingRef = useRef(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await api.post<{ user: UserDTO }>("/setup", {
        token,
        appName,
        brandColor,
        email,
        password,
        registrationEnabled,
      });
      await Promise.all([refreshConfig(), refreshAuth()]);
      toast.success("Setup complete — welcome!");
      navigate("/dashboard");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Setup failed");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg py-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <BrandMark className="size-12 text-xl" />
        <h1 className="display mt-3 text-3xl sm:text-4xl">
          Welcome — let’s get set up
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create your admin account and configure the basics. This runs only once.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">First-run setup</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="token">Setup token</Label>
              <Input
                id="token"
                type="password"
                required
                autoFocus
                placeholder="The SETUP_TOKEN you configured"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Set on the server via <code>wrangler secret put SETUP_TOKEN</code>.
              </p>
            </div>

            <div className="space-y-4 border-t pt-4">
              <p className="text-sm font-medium">Application</p>
              <div className="space-y-2">
                <Label htmlFor="appName">App name</Label>
                <Input
                  id="appName"
                  required
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="brandColor">Brand color</Label>
                <ColorPicker value={brandColor} onChange={setBrandColor} />
              </div>
            </div>

            <div className="space-y-4 border-t pt-4">
              <p className="text-sm font-medium">Admin account</p>
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
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <label className="flex cursor-pointer items-center justify-between gap-4 border-t pt-4">
              <span>
                <span className="block text-sm font-medium">
                  Allow public sign-ups
                </span>
                <span className="block text-xs text-muted-foreground">
                  You can change this later in Admin.
                </span>
              </span>
              <Switch
                checked={registrationEnabled}
                onCheckedChange={setRegistrationEnabled}
              />
            </label>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <Rocket />}
              Complete setup
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
