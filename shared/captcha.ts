// Human Check v3 — shared types between the Worker (challenge generation +
// verification) and the React client (rendering + interaction recording).
//
// SECURITY MODEL: everything in this file is public by definition — it travels
// to the browser. Nothing here may encode the *correct* answer; per-game
// secrets live in the worker-side game state and never leave the server.
// The client renders, records interaction, and submits — the server decides.

/** Admin-set verification mode (legacy values "off"/"game" map onto these). */
export type VerificationMode =
  | "disabled"
  | "invisible" // silent proof-of-work + risk; escalates to one easy game when unsure
  | "game-only"; // everyone plays the game(s); risk tunes difficulty + retries, not the count

/** The visual games an admin can put in the rotation pool. */
export const POOL_GAME_TYPES = [
  "slide",
  "drag-target",
  "tap-match",
  "rotate",
  "connect",
  "sort-3",
  "path-trace",
] as const;

/** All game types, including `key-count` — the non-visual, keyboard-only
 *  accessible alternative (Phase H). It is NOT in the pool; it's served only
 *  when the user explicitly asks for the accessible check, and it is validated
 *  server-side like any other game (not a bypass). */
export const GAME_TYPES = [...POOL_GAME_TYPES, "key-count"] as const;
export type GameType = (typeof GAME_TYPES)[number];

export type GameDifficulty = "easy" | "normal" | "hard";

/** The play surface is a short LANDSCAPE box (wider than tall) so the widget
 *  doesn't tower on a phone. Every game coordinate lives in this 100×SCENE_H
 *  space; the client scales it to the rendered size, so absolute pixel
 *  positions never appear in answers. */
export const SCENE_W = 100;
export const SCENE_H = 66;

export interface ScenePoint {
  x: number;
  y: number;
}

/** Internal (server-only) shape vocabulary. Drives the human-readable prompt
 *  ("Tap the star"); it is NEVER serialized to the client — see SceneObject.
 *  Each has an instantly-distinct silhouette so a real user is never confused. */
export type ShapeKind =
  | "circle"
  | "square"
  | "triangle"
  | "hexagon"
  | "star"
  | "heart"
  | "diamond"
  | "plus";

export interface SceneObject {
  id: string;
  /** The piece's outline as unit-space vertices (roughly [-1,1]), generated
   *  with per-challenge jitter and rotation baked in. A circle is signalled by
   *  `round` instead. CRITICAL: there is deliberately NO semantic shape name on
   *  the wire — to know which piece the prompt ("the star") refers to, a script
   *  must visually CLASSIFY the rendered outline, not read a field, and the
   *  per-challenge jitter defeats precomputing "this exact path = a star". This
   *  is the structural answer to "a bot just parses the JSON". */
  poly?: ScenePoint[];
  /** Render as a circle (no polygon outline). */
  round?: boolean;
  color: string; // hex — decorative only; no rule ever depends on color alone
  pos: ScenePoint; // center
  size: number; // radius in scene units
  /** Idle-bob animation phase (radians). Decorative motion that makes a
   *  static screenshot go stale; disabled under prefers-reduced-motion. */
  phase: number;
  label?: string;
}

// --- Per-game public payloads (rendering data only; no answers) ---------------

export interface DragTargetPayload {
  game: "drag-target";
  objects: SceneObject[]; // one subject + decoys, all draggable
  ring: { pos: ScenePoint; size: number }; // the dashed drop zone
}

/** Slide a handle along a horizontal track to the marked notch (the returning
 *  v2 favourite). The target is shown so the user can aim; the moat is the
 *  same as every game (PoW + single-use + a real drag, checked server-side). */
export interface SlidePayload {
  game: "slide";
  target: number; // 0–100 along the track
  color: string;
}

export interface TapMatchPayload {
  game: "tap-match";
  objects: SceneObject[]; // exactly one matches the prompt's shape
}

export interface RotatePayload {
  game: "rotate";
  arrow: { pos: ScenePoint; size: number; angle: number; color: string };
  /** Marker the arrow must point at, on a ring around the arrow's center. */
  dot: { angle: number; radius: number; size: number; color: string };
}

export interface ConnectPayload {
  game: "connect";
  objects: SceneObject[]; // exactly two share the subject shape
}

export interface SortPayload {
  game: "sort-3";
  objects: SceneObject[]; // same shape, clearly different sizes
}

export interface PathTracePayload {
  game: "path-trace";
  dots: SceneObject[]; // labelled "1".."n"; array order is shuffled
}

/** Phase H — the accessible, keyboard-only challenge. The server picks a short
 *  directional sequence; the client reveals one arrow at a time, advancing on
 *  each correct key and auto-submitting on the last (no Enter). Validated
 *  server-side against the sequence + human timing. */
export type ArrowDirection = "left" | "right" | "up" | "down";
export interface KeyCountPayload {
  game: "key-count";
  sequence: ArrowDirection[];
}

export type GamePublicPayload =
  | DragTargetPayload
  | SlidePayload
  | TapMatchPayload
  | RotatePayload
  | ConnectPayload
  | SortPayload
  | PathTracePayload
  | KeyCountPayload;

// --- Answers the client submits (validated server-side against secret state) --

export interface DragTargetAnswer {
  objectId: string;
}
export interface SlideAnswer {
  pos: number;
}
export interface TapMatchAnswer {
  objectId: string;
}
export interface RotateAnswer {
  angle: number; // final arrow angle, degrees
}
export interface ConnectAnswer {
  a: string;
  b: string;
}
export interface SortAnswer {
  order: string[];
}
export interface PathTraceAnswer {
  order: string[];
}
export interface KeyCountAnswer {
  pressed: number;
}

// --- Interaction evidence ------------------------------------------------------

export type CaptchaEventType =
  | "pointer-down"
  | "pointer-move"
  | "pointer-up"
  | "key-down";

/** One compact interaction event. Coordinates are scene units (0–100), so the
 *  same answer works at every screen size / zoom / pixel ratio. */
export interface CaptchaEvent {
  t: CaptchaEventType;
  x?: number;
  y?: number;
  targetId?: string;
  offsetMs: number; // ms since the game was shown
}

export type CaptchaInputMode = "mouse" | "touch" | "pen" | "keyboard" | "mixed";

/** Lightweight, NON-fingerprinting environment + session hints (Phase B/C).
 *  These are ephemeral abuse signals only — no font list, no persistent canvas
 *  hash, no raw renderer string, nothing cross-site or identifying. Each is
 *  trivially spoofable and weighted softly server-side; none can block a user
 *  on its own, and an honest report from a real browser scores zero. */
export interface CaptchaSignals {
  /** navigator.webdriver — true under most automation drivers (and easily
   *  faked, so it's a weak signal in the risk engine). */
  webdriver?: boolean;
  /** Whether the device exposes touch — context only, never penalized. */
  touch?: boolean;
  // --- Phase B: environment tells (reduced to booleans/counts, not raw data) --
  /** WebGL renderer is a software rasterizer (SwiftShader/llvmpipe/Mesa) — the
   *  default for most headless Chrome/Puppeteer. Real GPUs and many VMs differ. */
  softwareRender?: boolean;
  /** Count of classic headless tells (no languages, missing window.chrome on a
   *  Chrome UA, zero hardwareConcurrency, 0×0 screen, …). 0 for real browsers. */
  headlessHints?: number;
  // --- Phase C: whole-page session behavior (aggregates only) -----------------
  /** ms from page load to finishing the check — instant = suspicious. */
  pageDwellMs?: number;
  /** Did the user move a pointer / press a key anywhere on the page BEFORE the
   *  game? Humans browse; a script that lands straight on submit did not. */
  interactedBefore?: boolean;
  // --- Automation tells (count of globals a driver injects; 0 for real browsers) ---
  /** How many automation globals were present (chromedriver `cdc_`, Selenium,
   *  Playwright/Puppeteer/Nightmare/PhantomJS markers). Real browsers report 0. */
  automationMarkers?: number;
  /** True if ANY recorded pointer event had `isTrusted === false` — i.e. a
   *  synthetic `dispatchEvent` (naive Playwright/Selenium). Real input is always
   *  trusted; CDP-driven input is trusted too, so this only catches the lazy ones. */
  untrusted?: boolean;
  /** True if a script tampered with the inert client-side success canaries
   *  (`window.__captchaSolved`, `localStorage.captchaPassed`, …). A real client
   *  never touches them; the server ignores them — this is a tamper tell only. */
  clientCanary?: boolean;
}

export interface CaptchaEvidence {
  startedAtOffsetMs: number;
  completedAtOffsetMs: number;
  viewport: { w: number; h: number; dpr: number };
  inputMode: CaptchaInputMode;
  events: CaptchaEvent[];
  signals?: CaptchaSignals;
}

// --- API DTOs -------------------------------------------------------------------

/** Actions a verification token can be minted for. A token for one action is
 *  useless for any other — binding is enforced server-side at consume time. */
export const CAPTCHA_ACTIONS = ["login", "register"] as const;
export type CaptchaAction = (typeof CAPTCHA_ACTIONS)[number];

export interface CaptchaGameDTO {
  id: string;
  type: GameType;
  prompt: string;
  payload: GamePublicPayload;
}

export interface CaptchaChallengeDTO {
  /** Opaque challenge reference (256-bit random). The server stores only its
   *  hash; presenting it is the only way to continue this challenge. */
  ref: string;
  expiresAt: number; // epoch ms
  /** Proof-of-work the browser solves silently while the user plays. */
  pow: { difficulty: number } | null;
  /** First game to play, or null in invisible mode (may escalate later). */
  game: CaptchaGameDTO | null;
  gamesTotal: number;
  gameIndex: number; // 0-based
  limits: { maxEvents: number };
}

export interface CaptchaVerifyRequestDTO {
  ref: string;
  powSolution?: string;
  gameId?: string;
  answer?: unknown;
  evidence?: CaptchaEvidence;
}

export type CaptchaVerifyResponseDTO =
  | { status: "ok"; token: string; expiresAt: number }
  | {
      status: "next" | "retry";
      game: CaptchaGameDTO;
      gamesTotal: number;
      gameIndex: number;
      retriesLeft: number;
      expiresAt: number;
    };
