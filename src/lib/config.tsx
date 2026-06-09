import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AppConfigDTO } from "@shared/types";
import {
  DEFAULT_APP_NAME,
  DEFAULT_BRAND_COLOR,
  DEFAULT_OG_FONT,
  DEFAULT_OG_TEMPLATE,
} from "@shared/defaults";
import { api } from "./api";

const DEFAULT: AppConfigDTO = {
  needsSetup: false,
  appName: DEFAULT_APP_NAME,
  shortDomain: "",
  appOrigin: "",
  brandColor: DEFAULT_BRAND_COLOR,
  logoUrl: "",
  description: "",
  indexable: true,
  registrationEnabled: false,
  ogTemplate: DEFAULT_OG_TEMPLATE,
  ogFont: DEFAULT_OG_FONT,
  ogLabel: DEFAULT_APP_NAME,
  ogTitle: DEFAULT_APP_NAME,
  ogTagline: "",
  ogAccent: DEFAULT_BRAND_COLOR,
  domainUnverifiedDays: 90,
  apiEnabled: true,
  mcpEnabled: true,
  slugLength: 6,
  challengeMode: "off",
  powDifficulty: 0,
};

function upsertMeta(key: "name" | "property", keyName: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${key}="${keyName}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(key, keyName);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setFavicon(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "icon";
    document.head.appendChild(el);
  }
  el.href = href;
}

interface ConfigState {
  config: AppConfigDTO;
  loading: boolean;
  refresh: () => Promise<void>;
}

const ConfigContext = createContext<ConfigState | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfigDTO>(DEFAULT);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setConfig(await api.get<AppConfigDTO>("/config"));
    } catch {
      // keep defaults on failure
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    document.title = `${config.appName} — URL Shortener`;
  }, [config.appName]);

  // Brand color is dynamic — drive the accent CSS variables from config.
  useEffect(() => {
    const root = document.documentElement;
    for (const v of ["--primary", "--ring", "--sidebar-primary", "--sidebar-ring"]) {
      root.style.setProperty(v, config.brandColor);
    }
  }, [config.brandColor]);

  // Keep document meta (SEO + social) in sync with branding settings.
  useEffect(() => {
    const desc =
      config.description || `${config.appName} — a fast, clean URL shortener.`;
    upsertMeta("name", "description", desc);
    upsertMeta("name", "theme-color", config.brandColor);
    upsertMeta("property", "og:type", "website");
    upsertMeta("property", "og:site_name", config.appName);
    upsertMeta("property", "og:title", config.appName);
    upsertMeta("property", "og:description", desc);
    upsertMeta("property", "og:url", window.location.origin);
    upsertMeta("name", "twitter:card", config.logoUrl ? "summary_large_image" : "summary");
    upsertMeta("name", "twitter:title", config.appName);
    upsertMeta("name", "twitter:description", desc);
    upsertMeta("name", "robots", config.indexable ? "index,follow" : "noindex,nofollow");
    if (config.logoUrl) {
      upsertMeta("property", "og:image", config.logoUrl);
      upsertMeta("name", "twitter:image", config.logoUrl);
      setFavicon(config.logoUrl);
    }
  }, [config]);

  return (
    <ConfigContext.Provider value={{ config, loading, refresh }}>
      {children}
    </ConfigContext.Provider>
  );
}

/** The short link host to display (falls back to the current host). */
export function useShortHost(): string {
  const { config } = useConfig();
  return config.shortDomain || window.location.host;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfig(): ConfigState {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within a ConfigProvider");
  return ctx;
}
