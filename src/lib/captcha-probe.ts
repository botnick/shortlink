/**
 * Phase B/C — ephemeral environment + session probe, collected in the browser.
 *
 * PRIVACY: nothing here is persisted, hashed into an identifier, or shared
 * across sites. We reduce environment facts to a few booleans/counts (e.g. "is
 * the WebGL renderer a software rasterizer?" — NOT the raw renderer string) so
 * the result can't be used to fingerprint or track. It exists only to nudge the
 * server's risk score for the lifetime of one challenge.
 *
 * SECURITY: every value is computed in client code the attacker controls, so a
 * determined bot can fake all of them — that's fine. These are SOFT signals
 * weighted accordingly; their job is to catch the LAZY default automation
 * (headless Chrome with SwiftShader, a script that lands straight on submit)
 * that makes up most real abuse. An honest browser reports them as clean.
 */
import type { CaptchaSignals } from "@shared/captcha";

// Page-load reference + a one-shot "did the human do anything on this page yet?"
// flag. Set on the first real input, then the listeners remove themselves.
let pageLoadAt = 0;
let interacted = false;

if (typeof window !== "undefined") {
  pageLoadAt = performance.now();
  const mark = () => {
    interacted = true;
    window.removeEventListener("pointermove", mark);
    window.removeEventListener("pointerdown", mark);
    window.removeEventListener("keydown", mark);
  };
  window.addEventListener("pointermove", mark, { once: true, passive: true });
  window.addEventListener("pointerdown", mark, { once: true, passive: true });
  window.addEventListener("keydown", mark, { once: true, passive: true });

  // Client-side CANARY: inert markers that LOOK like a client-side pass switch.
  // They do nothing — the server decides everything — but a tinkerer who flips
  // `window.__captchaSolved = true` (or sets the localStorage/data-attr) thinks
  // they found a bypass. `clientCanaryTripped()` reports it as a tamper signal.
  try {
    (window as unknown as Record<string, unknown>).__captchaSolved = false;
    document.documentElement.dataset.captchaStatus = "pending";
  } catch {
    /* ignore */
  }
}

/** True if a script tampered with the inert client-side success canaries. */
function clientCanaryTripped(): boolean {
  try {
    const w = window as unknown as Record<string, unknown>;
    if (w.__captchaSolved === true || typeof w.__aegisDebugPass === "function") return true;
    if (document.documentElement.dataset.captchaStatus === "passed") return true;
    if (localStorage.getItem("captchaPassed") === "true") return true;
  } catch {
    /* localStorage can throw in privacy modes — never a tamper signal */
  }
  return false;
}

/** Is the WebGL renderer a known software rasterizer? (headless default) */
function isSoftwareRender(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ??
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return false; // no WebGL at all is common on locked-down/real devices — don't penalize
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software|microsoft basic|mesa offscreen/i.test(renderer);
  } catch {
    return false;
  }
}

/** Count classic headless/automation tells. Each is individually weak (and some
 *  fire on legitimate locked-down browsers), so the SERVER only acts on the
 *  count when it's high AND corroborated — never on one. */
function countHeadlessHints(): number {
  let n = 0;
  try {
    const ua = navigator.userAgent;
    const isChrome = /Chrome\//.test(ua) && !/Firefox\//.test(ua);
    // window.chrome is present on every real desktop+mobile Chrome.
    if (isChrome && !(window as { chrome?: unknown }).chrome) n++;
    // Real browsers expose at least one language.
    if (!navigator.languages || navigator.languages.length === 0) n++;
    // Headless often reports 0 cores or absurd values.
    if (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency < 1) n++;
    // A 0×0 / missing screen is not a real display.
    if (!window.screen || window.screen.width === 0 || window.screen.height === 0) n++;
    // Classic headless Chrome tell: permission state vs Notification.permission
    // disagree. Guarded so it never throws on browsers without the API.
    if (typeof Notification !== "undefined" && Notification.permission === "denied" && isChrome) {
      // not definitive on its own — counted as one weak hint
      n++;
    }
  } catch {
    /* any probe failure → just don't count it */
  }
  return n;
}

/** Count automation-driver globals. A genuine browser exposes NONE of these;
 *  each is injected by chromedriver / Selenium / Playwright / Puppeteer /
 *  Nightmare / PhantomJS. Trivially removable by a careful attacker (so it's a
 *  soft signal), but it catches the large majority that don't bother. */
function countAutomationMarkers(): number {
  let n = 0;
  try {
    const w = window as unknown as Record<string, unknown>;
    const d = document as unknown as Record<string, unknown>;
    // chromedriver injects a window.cdc_… and document.$cdc_… property
    for (const k of Object.keys(w)) {
      if (k.startsWith("cdc_") || k.startsWith("$cdc_")) { n++; break; }
    }
    for (const k of Object.keys(d)) {
      if (k.startsWith("$cdc_") || k.startsWith("__webdriver")) { n++; break; }
    }
    const tells = [
      "_phantom", "callPhantom", "__nightmare", "_selenium", "__selenium_unwrapped",
      "__webdriver_evaluate", "__driver_evaluate", "__fxdriver_evaluate",
      "domAutomation", "domAutomationController", "__playwright", "__pw_mangled",
      "__pwInitScripts", "$chrome_asyncScriptInfo", "webdriver",
    ];
    for (const t of tells) if (w[t] !== undefined) n++;
    // Selenium leaves attributes on the document element.
    const el = document.documentElement;
    if (el.getAttribute("webdriver") !== null || el.getAttribute("selenium") !== null || el.getAttribute("driver") !== null) n++;
  } catch {
    /* probe failures never throw */
  }
  return n;
}

/** Collect the ephemeral probe to attach to interaction evidence. */
export function collectProbe(): CaptchaSignals {
  const dwell =
    pageLoadAt > 0 ? Math.max(0, Math.round(performance.now() - pageLoadAt)) : undefined;
  return {
    webdriver: navigator.webdriver === true,
    touch: "ontouchstart" in window || navigator.maxTouchPoints > 0,
    softwareRender: isSoftwareRender(),
    headlessHints: countHeadlessHints(),
    pageDwellMs: dwell,
    interactedBefore: interacted,
    automationMarkers: countAutomationMarkers(),
    clientCanary: clientCanaryTripped(),
  };
}
