import { useEffect, useState, type FormEvent } from "react";
import { Loader2, MoreHorizontal, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfig } from "@/lib/config";
import { formatDate } from "@/lib/format";
import type { AdminUserDTO, Role, SettingsDTO } from "@shared/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function Admin() {
  const { user: me } = useAuth();
  const { refresh: refreshConfig } = useConfig();
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [users, setUsers] = useState<AdminUserDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingReg, setSavingReg] = useState(false);
  const [savingApp, setSavingApp] = useState(false);
  const [appName, setAppName] = useState("");
  const [shortDomain, setShortDomain] = useState("");
  const [brandColor, setBrandColor] = useState("#e5392e");
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [ogImageUrl, setOgImageUrl] = useState("");
  const [indexable, setIndexable] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<SettingsDTO>("/admin/settings"),
      api.get<{ users: AdminUserDTO[] }>("/admin/users"),
    ])
      .then(([s, u]) => {
        setSettings(s);
        setAppName(s.appName);
        setShortDomain(s.shortDomain);
        setBrandColor(s.brandColor);
        setLogoUrl(s.logoUrl);
        setDescription(s.description);
        setOgImageUrl(s.ogImageUrl);
        setIndexable(s.indexable);
        setUsers(u.users);
      })
      .catch(() => toast.error("Couldn't load admin data"))
      .finally(() => setLoading(false));
  }, []);

  async function patchSettings(body: Partial<SettingsDTO>): Promise<void> {
    const updated = await api.patch<SettingsDTO>("/admin/settings", body);
    setSettings(updated);
    await refreshConfig();
  }

  async function toggleRegistration(value: boolean) {
    setSavingReg(true);
    try {
      await patchSettings({ registrationEnabled: value });
      toast.success(value ? "Registration opened" : "Registration closed");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSavingReg(false);
    }
  }

  function pickImage(file: File | undefined, set: (v: string) => void) {
    if (!file) return;
    if (file.size > 300_000) {
      toast.error("Image too large — keep it under ~300KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function saveApp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavingApp(true);
    try {
      await patchSettings({
        appName,
        shortDomain,
        brandColor,
        logoUrl,
        description,
        ogImageUrl,
        indexable,
      });
      toast.success("Branding saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSavingApp(false);
    }
  }

  async function setRole(u: AdminUserDTO, role: Role) {
    try {
      await api.patch(`/admin/users/${u.id}`, { role });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, role } : x)));
      toast.success(
        role === "admin"
          ? `${u.email} is now an admin`
          : `${u.email} is no longer an admin`,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function removeUser(u: AdminUserDTO) {
    if (!window.confirm(`Delete ${u.email}? This removes their account and links.`)) {
      return;
    }
    try {
      await api.delete(`/admin/users/${u.id}`);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      toast.success("User deleted");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage sign-ups, branding and the team.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registration</CardTitle>
          <CardDescription>
            When closed, new accounts can’t be created.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span className="text-sm">
              {settings?.registrationEnabled
                ? "Sign-ups are open"
                : "Sign-ups are closed"}
            </span>
            {loading || !settings ? (
              <Skeleton className="h-5 w-9 rounded-full" />
            ) : (
              <Switch
                checked={settings.registrationEnabled}
                disabled={savingReg}
                onCheckedChange={toggleRegistration}
              />
            )}
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Application</CardTitle>
          <CardDescription>
            Branding shown across the app and on short links.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : (
            <form onSubmit={saveApp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="appName">App name</Label>
                <Input
                  id="appName"
                  required
                  maxLength={40}
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shortDomain">Short domain</Label>
                <Input
                  id="shortDomain"
                  placeholder="links.example.com"
                  value={shortDomain}
                  onChange={(e) => setShortDomain(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="brandColor">Brand color</Label>
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5">
                    <span
                      className="size-5 rounded border"
                      style={{ backgroundColor: brandColor }}
                    />
                    <span className="text-sm text-muted-foreground">
                      {brandColor}
                    </span>
                    <input
                      id="brandColor"
                      type="color"
                      value={brandColor}
                      onChange={(e) => setBrandColor(e.target.value)}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Logo</Label>
                <div className="flex items-center gap-3">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt=""
                      className="size-11 rounded-lg border object-contain p-1"
                    />
                  ) : (
                    <span className="flex size-11 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
                      none
                    </span>
                  )}
                  <label className="cursor-pointer rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => pickImage(e.target.files?.[0], setLogoUrl)}
                    />
                  </label>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={() => setLogoUrl("")}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="desc">
                  Description{" "}
                  <span className="font-normal text-muted-foreground">
                    (search & social)
                  </span>
                </Label>
                <textarea
                  id="desc"
                  rows={2}
                  maxLength={300}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A fast, clean URL shortener with analytics."
                  className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="space-y-2">
                <Label>
                  Social share image{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <div className="flex items-center gap-3">
                  {ogImageUrl ? (
                    <img
                      src={ogImageUrl}
                      alt=""
                      className="h-11 w-20 rounded-lg border object-cover"
                    />
                  ) : (
                    <span className="flex h-11 w-20 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
                      none
                    </span>
                  )}
                  <label className="cursor-pointer rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => pickImage(e.target.files?.[0], setOgImageUrl)}
                    />
                  </label>
                  {ogImageUrl && (
                    <button
                      type="button"
                      onClick={() => setOgImageUrl("")}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-between gap-4">
                <span className="text-sm">Allow search engines to index</span>
                <Switch checked={indexable} onCheckedChange={setIndexable} />
              </label>

              <Button type="submit" disabled={savingApp}>
                {savingApp && <Loader2 className="animate-spin" />}
                Save
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Team{users.length > 0 && ` (${users.length})`}
          </CardTitle>
          <CardDescription>
            Promote members to admin or remove them. The primary admin is protected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Links</TableHead>
                  <TableHead className="text-right">Joined</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isSelf = u.id === me?.id;
                  const actionable = !u.isPrimary && !isSelf;
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="max-w-[14rem] truncate font-medium">
                        {u.email}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={u.role === "admin" ? "default" : "muted"}>
                            {u.role}
                          </Badge>
                          {u.isPrimary && (
                            <Badge variant="secondary">Primary</Badge>
                          )}
                          {isSelf && (
                            <span className="text-xs text-muted-foreground">you</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {u.linkCount}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatDate(u.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {actionable ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="User actions"
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              {u.role === "user" ? (
                                <DropdownMenuItem onClick={() => setRole(u, "admin")}>
                                  <ShieldCheck /> Make admin
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => setRole(u, "user")}>
                                  <ShieldOff /> Remove admin
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => removeUser(u)}
                              >
                                <Trash2 /> Delete user
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
