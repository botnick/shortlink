/**
 * Decorative pixel-art backdrops for the human check. PURELY cosmetic — they
 * render BEHIND the game with pointer-events disabled and never touch the
 * answer. The interactive pieces stay procedurally generated + jittered, so the
 * anti-bot property is untouched; these just give the widget a 16-bit game-screen
 * feel, and a different one each challenge so it never gets stale.
 *
 * Everything is drawn in the same 100×SCENE_H viewBox as the game, with a small
 * SEEDED RNG so each render is varied but stable for its lifetime. No animation
 * (reduced-motion friendly), modest element counts (mobile friendly).
 */
import { createContext } from "react";
import { SCENE_H, SCENE_W, type GameType } from "@shared/captcha";

/** mulberry32 — tiny deterministic RNG so a theme varies by seed but is stable. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = SCENE_W, H = SCENE_H;
const px = { shapeRendering: "crispEdges" as const };

type Draw = (r: () => number) => { bg: string; els: React.ReactNode };

// --- 1. Cyberpunk city at night ---------------------------------------------
const cyber: Draw = (r) => {
  const neon = ["#ff3da6", "#36e0ff", "#a06bff", "#ffd23d"];
  const buildings = Array.from({ length: 10 }, (_, i) => {
    const bw = 7 + r() * 5;
    const bh = 12 + r() * 30;
    return { x: i * 10 + r() * 2, w: bw, h: bh, c: `#${(10 + Math.floor(r() * 12)).toString(16)}1b30` };
  });
  return {
    bg: "#0a0e1c",
    els: (
      <>
        <rect x={0} y={0} width={W} height={H} fill="url(#cyberSky)" {...px} />
        {/* skyline */}
        {buildings.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={H - b.h} width={b.w} height={b.h} fill="#121a30" {...px} />
            {/* lit windows */}
            {Array.from({ length: Math.floor(b.h / 4) }).map((_, k) =>
              r() > 0.55 ? (
                <rect key={k} x={b.x + 1 + (r() > 0.5 ? 2.5 : 0)} y={H - b.h + 2 + k * 4} width={1.6} height={1.6} fill={cyberPick(neon, r)} opacity={0.9} {...px} />
              ) : null,
            )}
          </g>
        ))}
        {/* neon signs */}
        {Array.from({ length: 5 }).map((_, i) => (
          <rect key={i} x={5 + r() * 88} y={6 + r() * 26} width={2 + r() * 6} height={1.4} fill={cyberPick(neon, r)} opacity={0.85} {...px} />
        ))}
        {/* horizon glow */}
        <rect x={0} y={H - 2} width={W} height={2} fill="#ff3da6" opacity={0.25} {...px} />
      </>
    ),
  };
};
function cyberPick(a: string[], r: () => number) {
  return a[Math.floor(r() * a.length)];
}

// --- 2. Space / orbit --------------------------------------------------------
const space: Draw = (r) => ({
  bg: "#05060f",
  els: (
    <>
      {Array.from({ length: 46 }).map((_, i) => {
        const s = r() > 0.85 ? 1.4 : 0.8;
        return <rect key={i} x={r() * W} y={r() * H} width={s} height={s} fill="#cdd6f4" opacity={0.4 + r() * 0.6} {...px} />;
      })}
      {/* planet */}
      <circle cx={78} cy={50} r={16} fill="#2a3a6e" />
      <circle cx={78} cy={50} r={16} fill="url(#planetShade)" />
      {Array.from({ length: 5 }).map((_, i) => (
        <rect key={i} x={66 + i * 5} y={44 + (i % 2) * 4} width={3} height={1.5} fill="#6f86d6" opacity={0.5} {...px} />
      ))}
      {/* ring */}
      <ellipse cx={78} cy={50} rx={24} ry={5} fill="none" stroke="#8aa0e8" strokeWidth={0.8} opacity={0.5} />
    </>
  ),
});

// --- 3. Synthwave grid + sun -------------------------------------------------
const synth: Draw = () => ({
  bg: "#1a0b2e",
  els: (
    <>
      <rect x={0} y={0} width={W} height={H} fill="url(#synthSky)" {...px} />
      {/* sun with scanlines */}
      <circle cx={50} cy={26} r={15} fill="url(#sun)" />
      {Array.from({ length: 5 }).map((_, i) => (
        <rect key={i} x={34} y={20 + i * 3.2} width={32} height={1.4} fill="#1a0b2e" {...px} />
      ))}
      {/* perspective grid */}
      {Array.from({ length: 8 }).map((_, i) => (
        <line key={i} x1={50} y1={40} x2={i * 14.3} y2={H} stroke="#ff4d9d" strokeWidth={0.5} opacity={0.45} />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <line key={`h${i}`} x1={0} y1={40 + i * i * 0.9 + i * 2} x2={W} y2={40 + i * i * 0.9 + i * 2} stroke="#36e0ff" strokeWidth={0.4} opacity={0.45} />
      ))}
    </>
  ),
});

// --- 4. Forest night ---------------------------------------------------------
const forest: Draw = (r) => ({
  bg: "#07140e",
  els: (
    <>
      <rect x={0} y={0} width={W} height={H} fill="url(#forestSky)" {...px} />
      <circle cx={20} cy={16} r={6} fill="#e7eccd" opacity={0.9} />
      {/* trees */}
      {Array.from({ length: 9 }).map((_, i) => {
        const x = i * 11 + r() * 3;
        const th = 18 + r() * 16;
        return (
          <g key={i}>
            {[0, 1, 2].map((k) => {
              const top = H - th + k * th * 0.28;
              const baseY = top + th * 0.4;
              return (
                <polygon
                  key={k}
                  points={`${x},${top} ${x - 6 + k},${baseY} ${x + 6 - k},${baseY}`}
                  fill={k === 0 ? "#15402a" : "#0f3320"}
                  {...px}
                />
              );
            })}
          </g>
        );
      })}
      {/* fireflies */}
      {Array.from({ length: 7 }).map((_, i) => (
        <rect key={i} x={r() * W} y={20 + r() * 30} width={1.2} height={1.2} fill="#ffe27a" opacity={0.8} {...px} />
      ))}
    </>
  ),
});

// --- 5. Dungeon --------------------------------------------------------------
const dungeon: Draw = (r) => ({
  bg: "#120f0c",
  els: (
    <>
      {/* brick grid */}
      {Array.from({ length: 6 }).map((_, row) =>
        Array.from({ length: 9 }).map((__, col) => (
          <rect
            key={`${row}-${col}`}
            x={col * 11.5 + (row % 2 ? 5 : 0)}
            y={row * 11}
            width={10.5}
            height={10}
            fill={`#${(24 + Math.floor(r() * 8)).toString(16)}1a12`}
            stroke="#0a0806"
            strokeWidth={0.5}
            {...px}
          />
        )),
      )}
      {/* torch glows */}
      {[24, 76].map((x, i) => (
        <g key={i}>
          <circle cx={x} cy={22} r={12} fill="#ff8a2a" opacity={0.12} />
          <circle cx={x} cy={22} r={6} fill="#ffb24a" opacity={0.18} />
          <rect x={x - 1} y={20} width={2} height={5} fill="#5a3a1a" {...px} />
          <rect x={x - 1.5} y={17} width={3} height={3} fill="#ffd152" {...px} />
        </g>
      ))}
    </>
  ),
});

// --- 6. Ocean ----------------------------------------------------------------
const ocean: Draw = (r) => ({
  bg: "#04121f",
  els: (
    <>
      <rect x={0} y={0} width={W} height={H} fill="url(#oceanSky)" {...px} />
      {/* light rays */}
      {Array.from({ length: 4 }).map((_, i) => (
        <polygon key={i} points={`${20 + i * 22},0 ${10 + i * 22},${H} ${28 + i * 22},${H}`} fill="#9fe3ff" opacity={0.05} />
      ))}
      {/* bubbles */}
      {Array.from({ length: 16 }).map((_, i) => {
        const rad = 0.8 + r() * 2.2;
        return <circle key={i} cx={r() * W} cy={r() * H} r={rad} fill="none" stroke="#7fd0ff" strokeWidth={0.5} opacity={0.4} />;
      })}
      {/* seabed */}
      <rect x={0} y={H - 4} width={W} height={4} fill="#0a2238" {...px} />
    </>
  ),
});

// --- 7. Sunset hills (warm / cozy) -------------------------------------------
const sunset: Draw = (r) => ({
  bg: "#2a1430",
  els: (
    <>
      <rect x={0} y={0} width={W} height={H} fill="url(#sunsetSky)" {...px} />
      <circle cx={50} cy={30} r={13} fill="#ffd36b" opacity={0.92} />
      {[0, 1, 2].map((k) => (
        <ellipse key={k} cx={18 + k * 30} cy={H + 6 - k * 2} rx={42} ry={15 + k * 2} fill={k % 2 ? "#3a1f3e" : "#52223f"} />
      ))}
      {Array.from({ length: 4 }).map((_, i) => (
        <text key={i} x={18 + r() * 60} y={12 + r() * 10} fontSize={4} fill="#2a1430">︿</text>
      ))}
    </>
  ),
});

// --- 8. Desert ---------------------------------------------------------------
const desert: Draw = () => ({
  bg: "#3a2a14",
  els: (
    <>
      <rect x={0} y={0} width={W} height={H} fill="url(#desertSky)" {...px} />
      <circle cx={72} cy={18} r={10} fill="#ffe7a0" opacity={0.85} />
      {[0, 1].map((k) => (
        <ellipse key={k} cx={30 + k * 45} cy={H + 6} rx={48} ry={18} fill={k ? "#7a5a2e" : "#6a4e28"} />
      ))}
      {[20, 82].map((x, i) => (
        <g key={i}>
          <rect x={x} y={H - 15} width={2.6} height={15} fill="#2f5a35" {...px} />
          <rect x={x - 3} y={H - 11} width={3} height={2.6} fill="#2f5a35" {...px} />
          <rect x={x + 2.6} y={H - 9} width={3} height={2.6} fill="#2f5a35" {...px} />
        </g>
      ))}
    </>
  ),
});

// --- 9. Lava cavern ----------------------------------------------------------
const lava: Draw = (r) => ({
  bg: "#190707",
  els: (
    <>
      {Array.from({ length: 26 }).map((_, i) => (
        <rect key={i} x={r() * W} y={r() * (H - 10)} width={1 + r()} height={1 + r()} fill={r() > 0.5 ? "#ff7a2a" : "#ff3b1a"} opacity={0.5 + r() * 0.4} {...px} />
      ))}
      <rect x={0} y={H - 7} width={W} height={7} fill="#4a0f0f" {...px} />
      {Array.from({ length: 12 }).map((_, i) => (
        <rect key={i} x={i * 8.6} y={H - 7} width={3 + r() * 2} height={7} fill="#ff5a1a" opacity={0.55} {...px} />
      ))}
      <rect x={0} y={H - 7} width={W} height={1.4} fill="#ffd23d" opacity={0.7} {...px} />
    </>
  ),
});

// --- 10. Game Boy mono (8-bit nostalgia) -------------------------------------
const gameboy: Draw = (r) => {
  const pal = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"];
  return {
    bg: "#0f380f",
    els: (
      <>
        {Array.from({ length: 7 }).map((_, row) =>
          Array.from({ length: 12 }).map((__, col) =>
            r() > 0.72 ? (
              <rect key={`${row}-${col}`} x={col * 8.5} y={row * 9.6} width={8} height={9} fill={pal[1 + Math.floor(r() * 3)]} opacity={0.35} {...px} />
            ) : null,
          ),
        )}
        <rect x={0} y={0} width={W} height={H} fill="none" stroke="#9bbc0f" strokeWidth={1} opacity={0.2} {...px} />
      </>
    ),
  };
};

// --- 11. Aurora over mountains ----------------------------------------------
const aurora: Draw = (r) => ({
  bg: "#04101e",
  els: (
    <>
      {Array.from({ length: 28 }).map((_, i) => (
        <rect key={i} x={r() * W} y={r() * 30} width={0.9} height={0.9} fill="#dbe4ff" opacity={0.5 + r() * 0.5} {...px} />
      ))}
      {["#3affa0", "#7a5cff", "#36e0ff"].map((c, i) => (
        <rect key={i} x={0} y={5 + i * 6} width={W} height={4} fill={c} opacity={0.13} {...px} />
      ))}
      {[0, 1, 2, 3].map((k) => (
        <polygon key={k} points={`${k * 30},${H} ${k * 30 + 18},${H - 22 - (k % 2) * 8} ${k * 30 + 36},${H}`} fill={k % 2 ? "#0e2236" : "#13304a"} {...px} />
      ))}
    </>
  ),
});

const THEMES: { name: string; draw: Draw }[] = [
  { name: "cyber", draw: cyber },
  { name: "space", draw: space },
  { name: "synth", draw: synth },
  { name: "forest", draw: forest },
  { name: "dungeon", draw: dungeon },
  { name: "ocean", draw: ocean },
  { name: "sunset", draw: sunset },
  { name: "desert", draw: desert },
  { name: "lava", draw: lava },
  { name: "gameboy", draw: gameboy },
  { name: "aurora", draw: aurora },
];

/** Bright piece palettes that pop on each theme's dark backdrop — same order as
 *  THEMES. Recoloring the game pieces from these makes them feel part of the
 *  scene. Color is purely decorative (no rule ever depends on it), so this can
 *  never affect verification. */
const THEME_PALETTES: string[][] = [
  ["#ff3da6", "#36e0ff", "#ffd23d", "#a06bff"], // cyber
  ["#7fd0ff", "#ffd23d", "#ff6f91", "#b88cff"], // space
  ["#ff4d9d", "#36e0ff", "#ffd76b", "#b06bff"], // synth
  ["#ffe27a", "#9ad06b", "#ff9f6b", "#7fd0ff"], // forest
  ["#ffb24a", "#ffd152", "#e0703a", "#d8b878"], // dungeon
  ["#7fd0ff", "#9fe3ff", "#ffd23d", "#5affd0"], // ocean
  ["#ffd36b", "#ff8c5a", "#ff6f91", "#ffe27a"], // sunset
  ["#ffd76b", "#ff9f6b", "#6abf7a", "#f0d9a8"], // desert
  ["#ff7a2a", "#ffd23d", "#ff5a4a", "#ffae5a"], // lava
  ["#9bbc0f", "#cfe85a", "#8bac0f", "#bcd647"], // gameboy
  ["#3affa0", "#7a5cff", "#36e0ff", "#dbe4ff"], // aurora
];

const THEME_INDEX: Record<string, number> = Object.fromEntries(
  THEMES.map((t, i) => [t.name, i]),
);

/**
 * Each game type gets a POOL of scenes whose mood fits its mechanic — so the
 * backdrop reinforces what you're doing (a rail for "slide", a docking ring for
 * "drag-target", a calm field for "tap"/"sort") yet never looks the same twice.
 * The seed picks one scene from the pool AND varies that scene's interior, so a
 * CV model can't memorise a fixed layout. Cohesion + variety, no logic touched.
 */
const THEME_POOLS: Record<GameType, string[]> = {
  slide: ["cyber", "synth"], // a horizontal rail / neon track
  "drag-target": ["space", "desert"], // open field + a place to dock/land
  "tap-match": ["forest", "ocean"], // calm, uncluttered — the match stands out
  rotate: ["aurora", "space"], // a dial against the sky / orbit
  connect: ["synth", "cyber"], // a grid/network the link rides along
  "sort-3": ["dungeon", "lava"], // a shelf/ledge to line things up on
  "path-trace": ["ocean", "forest"], // a trail through bubbles / a glade
  "key-count": ["aurora", "forest"], // calm screens for the keyboard game
};

/** Resolve a game type + seed to a concrete theme index (pool pick by seed). */
function themeIndexFor(gameType: GameType | undefined, seed: number): number {
  const pool = gameType ? THEME_POOLS[gameType] : undefined;
  if (pool && pool.length) {
    const name = pool[Math.abs(seed) % pool.length];
    return THEME_INDEX[name] ?? 0;
  }
  return Math.abs(seed) % THEMES.length;
}

/** Piece palette matching the scene a given game type + seed will show. */
export function paletteForGame(gameType: GameType | undefined, seed: number): string[] {
  return THEME_PALETTES[themeIndexFor(gameType, seed)];
}

/** Active piece palette for the current challenge (null = use the server color). */
export const CaptchaPaletteContext = createContext<string[] | null>(null);

/** True when the user/browser asked to save data — skip the decorative backdrop. */
function dataSaver(): boolean {
  const c = (navigator as { connection?: { saveData?: boolean } }).connection;
  return c?.saveData === true;
}

/** A decorative, non-interactive backdrop. The game type picks a fitting scene
 *  (a painted 16-bit pixel-art screen); the seed chooses which of the pool and
 *  mirrors it for variety. The hand-drawn SVG paints instantly underneath and
 *  remains the fallback under Save-Data or if the art can't load. A contrast
 *  scrim keeps the bright game pieces readable over the busy scene. */
export function ThemeBackground({
  seed,
  gameType,
}: {
  seed: number;
  gameType?: GameType;
}) {
  const idx = themeIndexFor(gameType, seed);
  const saver = dataSaver();
  const flip = (Math.abs(seed) & 1) === 1;
  // A handful of seeded twinkles drifting over the upper scene — pure ambiance.
  const sr = makeRng(seed * 40503 + 7);
  const sparkles = Array.from({ length: 7 }, () => ({
    x: 6 + sr() * 88,
    y: 4 + sr() * 36,
    r: 0.4 + sr() * 0.5,
    d: sr() * 3,
  }));
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <ProceduralBackground idx={idx} seed={seed} />
      {!saver && (
        <img
          src={`/captcha-scenes/${THEMES[idx].name}.webp`}
          alt=""
          decoding="async"
          draggable={false}
          className="absolute inset-0 size-full object-cover"
          style={{
            transform: flip ? "scaleX(-1)" : undefined,
            // Dim + slightly soften the art so it reads as a backdrop and the
            // bright foreground pieces / game guides clearly sit on top of it.
            filter: "brightness(0.6) saturate(1.08) blur(0.4px)",
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.opacity = "0";
          }}
        />
      )}
      {/* A flat darkening + an edge vignette: the scene becomes ambience, the
          game (pieces, tracks, rings) stays the clear subject. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(rgba(6,8,16,0.42), rgba(6,8,16,0.42)), radial-gradient(130% 105% at 50% 44%, rgba(0,0,0,0) 26%, rgba(0,0,0,0.5) 100%)",
        }}
      />
      {!saver && (
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" aria-hidden="true">
          {sparkles.map((s, i) => (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="#fffbe6"
              className="hc-twinkle"
              style={{ animationDelay: `${s.d.toFixed(2)}s` }}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

/** The original hand-drawn SVG scene — an instant first paint and the graceful
 *  fallback whenever the painted art can't show. */
function ProceduralBackground({ idx, seed }: { idx: number; seed: number }) {
  const r = makeRng(seed * 2654435761);
  const { bg, els } = THEMES[idx].draw(r);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="pointer-events-none absolute inset-0 size-full"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="cyberSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#160a2e" />
          <stop offset="1" stopColor="#0a0e1c" />
        </linearGradient>
        <linearGradient id="synthSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a0e44" />
          <stop offset="1" stopColor="#0b0418" />
        </linearGradient>
        <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd76b" />
          <stop offset="1" stopColor="#ff4d9d" />
        </linearGradient>
        <linearGradient id="forestSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c2438" />
          <stop offset="1" stopColor="#07140e" />
        </linearGradient>
        <linearGradient id="oceanSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a3554" />
          <stop offset="1" stopColor="#04121f" />
        </linearGradient>
        <linearGradient id="sunsetSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff8c5a" />
          <stop offset="0.5" stopColor="#b04a7e" />
          <stop offset="1" stopColor="#2a1430" />
        </linearGradient>
        <linearGradient id="desertSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fc0d8" />
          <stop offset="1" stopColor="#e8c48a" />
        </linearGradient>
        <radialGradient id="planetShade" cx="0.35" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#5a74c8" />
          <stop offset="1" stopColor="#1a2548" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill={bg} {...px} />
      {els}
      {/* gentle vignette so the bright pieces always pop on top */}
      <rect x={0} y={0} width={W} height={H} fill="#000" opacity={0.18} {...px} />
    </svg>
  );
}
