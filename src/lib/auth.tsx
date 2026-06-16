import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UserDTO } from "@shared/types";
import { api, setUnauthorizedHandler } from "./api";

interface AuthState {
  user: UserDTO | null;
  loading: boolean;
  login: (
    email: string,
    password: string,
    extra?: Record<string, unknown>,
  ) => Promise<void>;
  register: (
    email: string,
    password: string,
    extra?: Record<string, unknown>,
  ) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: UserDTO | null }>("/auth/me");
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Clear auth on a 401 from any authenticated request (expired/revoked session)
  // so ProtectedRoute redirects to login instead of holding stale user state.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(
    async (email: string, password: string, extra?: Record<string, unknown>) => {
      const { user } = await api.post<{ user: UserDTO }>("/auth/login", {
        ...extra,
        email,
        password,
      });
      setUser(user);
    },
    [],
  );

  const register = useCallback(
    async (email: string, password: string, extra?: Record<string, unknown>) => {
      const { user } = await api.post<{ user: UserDTO }>("/auth/register", {
        ...extra,
        email,
        password,
      });
      setUser(user);
    },
    [],
  );

  const logout = useCallback(async () => {
    // Always clear local auth, even if the server call fails (network error or
    // an already-expired session) — the UI must never stay "signed in".
    try {
      await api.post("/auth/logout");
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
