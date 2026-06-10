import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  KeyRound,
  Loader2,
  LogOut,
  Monitor,
  ShieldAlert,
  Smartphone,
  Tablet,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { SessionDTO, SessionListDTO } from "@shared/types";
import { formatDate, timeAgo } from "@/lib/format";
import { Hint } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ConfirmProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AccountDTO {
  email: string;
  role: string;
  createdAt: string;
  activeSessions: number;
}

export function Account() {
  const { logout } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const [info, setInfo] = useState<AccountDTO | null>(null);
  const [sessions, setSessions] = useState<SessionDTO[] | null>(null);

  // Change password
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  // Delete account
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleting, setDeleting] = useState(false);

  function load() {
    api
      .get<AccountDTO>("/account")
      .then(setInfo)
      .catch(() => toast.error("Couldn't load your account"));
    api
      .get<SessionListDTO>("/account/sessions")
      .then((r) => setSessions(r.sessions))
      .catch(() => {});
  }
  useEffect(load, []);

  async function revokeSession(s: SessionDTO) {
    const ok = await confirm({
      title: "Sign out this device?",
      description: `${s.browser ?? "Unknown browser"} on ${s.os ?? "unknown OS"} will need to sign in again.`,
      confirmLabel: "Sign out device",
    });
    if (!ok) return;
    try {
      await api.delete(`/account/sessions/${s.id}`);
      load();
      toast.success("Device signed out");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't sign it out");
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setSavingPw(true);
    try {
      await api.patch("/account/password", {
        currentPassword: curPw,
        newPassword: newPw,
      });
      setCurPw("");
      setNewPw("");
      load();
      toast.success("Password changed — other devices were signed out");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't change the password");
    } finally {
      setSavingPw(false);
    }
  }

  async function signOutOthers() {
    const ok = await confirm({
      title: "Sign out everywhere else?",
      description: "All other devices and browsers will need to sign in again.",
      confirmLabel: "Sign out others",
    });
    if (!ok) return;
    try {
      const r = await api.post<{ revoked: number }>("/account/sessions/revoke-others");
      load();
      toast.success(
        r.revoked > 0
          ? `Signed out ${r.revoked} other session${r.revoked === 1 ? "" : "s"}`
          : "No other sessions were active",
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't sign out others");
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    setDeleting(true);
    try {
      await api.delete("/account", { currentPassword: deletePw });
      toast.success("Account deleted");
      await logout().catch(() => {});
      navigate("/");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't delete the account");
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="display text-3xl">Account</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Your sign-in details and active sessions.
        </p>
      </div>

      {/* Summary */}
      {info === null ? (
        <Skeleton className="h-[72px] w-full" />
      ) : (
        <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <User className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{info.email}</span>
              {info.role === "admin" && <Badge>Admin</Badge>}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              Joined {formatDate(info.createdAt)}
            </div>
          </div>
        </div>
      )}

      {/* Active sessions */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Monitor className="size-4 text-muted-foreground" /> Active sessions
              </CardTitle>
              <CardDescription>
                Everywhere this account is signed in right now.
              </CardDescription>
            </div>
            {sessions !== null && sessions.length > 1 && (
              <Button variant="outline" size="sm" onClick={signOutOthers}>
                <LogOut /> Sign out others
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {sessions === null ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <ul className="divide-y">
              {sessions.map((s) => {
                const DeviceIcon =
                  s.deviceType === "mobile"
                    ? Smartphone
                    : s.deviceType === "tablet"
                      ? Tablet
                      : Monitor;
                return (
                  <li key={s.id} className="flex items-center gap-3 py-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <DeviceIcon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">
                          {[s.browser, s.os].filter(Boolean).join(" · ") ||
                            "Unknown device"}
                        </span>
                        {s.current && (
                          <Badge variant="success" className="shrink-0">
                            This device
                          </Badge>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {s.country ? `${s.country} · ` : ""}
                        Active {timeAgo(s.lastActiveAt)} · signed in{" "}
                        {formatDate(s.createdAt)}
                      </div>
                    </div>
                    {!s.current && (
                      <Hint label="Sign out this device">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Sign out this device"
                          onClick={() => revokeSession(s)}
                        >
                          <Trash2 />
                        </Button>
                      </Hint>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-muted-foreground" /> Change password
            </CardTitle>
            <CardDescription>
              Changing it signs out every other device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={changePassword} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="cur-pw">Current password</Label>
                <Input
                  id="cur-pw"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={curPw}
                  onChange={(e) => setCurPw(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-pw">New password</Label>
                <Input
                  id="new-pw"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={savingPw || !curPw || newPw.length < 8}>
                {savingPw && <Loader2 className="animate-spin" />}
                Change password
              </Button>
            </form>
          </CardContent>
        </Card>

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4 text-destructive" /> Danger zone
          </CardTitle>
          <CardDescription>
            Deleting your account removes every link, domain and API key — permanently.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}>
            Delete account…
          </Button>
        </CardContent>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) setDeletePw(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Every short link stops working immediately. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={deleteAccount} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="del-pw">Confirm with your password</Label>
              <Input
                id="del-pw"
                type="password"
                autoComplete="current-password"
                required
                value={deletePw}
                onChange={(e) => setDeletePw(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              variant="destructive"
              className="w-full"
              disabled={deleting || !deletePw}
            >
              {deleting && <Loader2 className="animate-spin" />}
              Delete my account
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
