import { Link, Outlet, useNavigate } from "react-router-dom";
import { ChevronDown, Globe, KeyRound, LayoutDashboard, LogOut, Shield, User } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useConfig } from "@/lib/config";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Layout() {
  const { user, logout } = useAuth();
  const { config } = useConfig();
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await logout();
      toast.success("Signed out");
      navigate("/login");
    } catch {
      toast.error("Couldn't sign out");
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to={user ? "/dashboard" : "/"} className="rounded-md">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2 px-2">
                    <span className="flex size-7 items-center justify-center rounded-full border bg-card">
                      <User className="size-3.5 text-muted-foreground" />
                    </span>
                    <span className="hidden max-w-[18ch] truncate text-sm sm:inline">
                      {user.email}
                    </span>
                    <ChevronDown className="size-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  <DropdownMenuLabel className="flex flex-col gap-1">
                    <span className="truncate font-normal text-muted-foreground">
                      {user.email}
                    </span>
                    {user.role === "admin" && (
                      <Badge variant="default" className="w-fit">
                        Admin
                      </Badge>
                    )}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/dashboard">
                      <LayoutDashboard />
                      Dashboard
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/domains">
                      <Globe />
                      Domains
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/apikeys">
                      <KeyRound />
                      API keys
                    </Link>
                  </DropdownMenuItem>
                  {user.role === "admin" && (
                    <DropdownMenuItem asChild>
                      <Link to="/admin">
                        <Shield />
                        Admin
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={handleLogout}>
                    <LogOut />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button asChild size="sm">
                <Link to="/login">Sign in</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t py-6">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <span>{config.appName} — a fast, clean URL shortener.</span>
          <span className="flex items-center gap-3">
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
