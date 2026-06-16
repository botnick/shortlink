import { useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { KeyCountPayload, ScenePoint } from "@shared/captcha";
import { darken, lighten, pixelate } from "@/lib/pixel";
import { cn } from "@/lib/utils";
import { CaptchaPaletteContext } from "../themes";
import type { GameProps } from "./types";

/** Arrow key code per direction. */
const ARROW_KEY: Record<string, string> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
};

// A right-pointing arrow as a unit-space polygon (~[-1,1], y-down): a 3-thick
// shaft on the left meeting a 45° triangular head on the right. Rasterized to a
// pixel grid below so it renders as a crisp sprite that matches the game pieces.
const ARROW_POLY: ScenePoint[] = [
  { x: -0.94, y: -0.26 },
  { x: 0.06, y: -0.26 },
  { x: 0.06, y: -0.6 },
  { x: 0.92, y: 0 },
  { x: 0.06, y: 0.6 },
  { x: 0.06, y: 0.26 },
  { x: -0.94, y: 0.26 },
];

/** Rotate a polygon by k quarter-turns (y-down space: (x,y) → (-y,x)). */
function rotPoly(poly: ScenePoint[], k: number): ScenePoint[] {
  let p = poly;
  for (let i = 0; i < (k & 3); i++) p = p.map(({ x, y }) => ({ x: -y, y: x }));
  return p;
}

// Quarter-turns from the base (right-pointing) arrow for each direction.
const DIR_TURNS: Record<string, number> = { right: 0, down: 1, left: 2, up: 3 };

const ARROW_CELLS = 13;

/** The direction arrow drawn in the same pixel-art style as the game pieces —
 *  rasterized polygon, darker outline + lighter top bevel, recolored to the
 *  active theme. Purely decorative (the prompt text carries the instruction). */
function PixelArrow({ direction }: { direction: string }) {
  const palette = useContext(CaptchaPaletteContext);
  const color = palette?.[0] ?? "#ffd23d";
  const edgeColor = useMemo(() => darken(color, 0.6), [color]);
  const ramp = useMemo(
    () => [
      lighten(color, 0.5),
      lighten(color, 0.22),
      color,
      darken(color, 0.2),
      darken(color, 0.4),
    ],
    [color],
  );
  const specColor = useMemo(() => lighten(color, 0.82), [color]);

  const paths = useMemo(() => {
    const poly = rotPoly(ARROW_POLY, DIR_TURNS[direction] ?? 0);
    const cells = pixelate(poly, false, ARROW_CELLS);
    const px = 2 / ARROW_CELLS;
    const w = (px * 1.03).toFixed(3);
    const xs = cells.map((c) => c.gx);
    const ys = cells.map((c) => c.gy);
    const minX = Math.min(...xs);
    const spanX = Math.max(1, Math.max(...xs) - minX);
    const minY = Math.min(...ys);
    const spanY = Math.max(1, Math.max(...ys) - minY);
    const sorted = [...cells].sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
    const spec = new Set(sorted.slice(0, 1).map((c) => `${c.gx},${c.gy}`));
    const tiers = ["", "", "", "", ""];
    let outline = "", glint = "";
    for (const c of cells) {
      const x = (-1 + c.gx * px).toFixed(3);
      const y = (-1 + c.gy * px).toFixed(3);
      const seg = `M${x} ${y}h${w}v${w}h-${w}z`;
      const key = `${c.gx},${c.gy}`;
      if (spec.has(key)) glint += seg;
      else if (c.edge && !c.topEdge) outline += seg;
      else {
        const s = (1 - (c.gy - minY) / spanY) * 0.6 + (1 - (c.gx - minX) / spanX) * 0.4;
        tiers[Math.min(4, Math.max(0, Math.round((1 - s) * 4)))] += seg;
      }
    }
    return { outline, tiers, glint };
  }, [direction]);

  return (
    <svg viewBox="-1.1 -1.1 2.2 2.2" className="size-full" aria-hidden="true">
      {paths.outline && <path d={paths.outline} fill={edgeColor} shapeRendering="crispEdges" />}
      {paths.tiers.map((d, i) =>
        d ? <path key={i} d={d} fill={ramp[i]} shapeRendering="crispEdges" /> : null,
      )}
      {paths.glint && (
        <path d={paths.glint} className="hc-glint" fill={specColor} shapeRendering="crispEdges" />
      )}
    </svg>
  );
}

/**
 * Phase H — the accessible, keyboard-only challenge. Fully operable and
 * understandable without sight: the instruction is the prompt (read by the
 * screen reader), an aria-live region announces progress, and nothing has to be
 * seen, dragged, or done quickly. Validated server-side like any other game.
 */
export function KeyCountGame({ game, rec, disabled, onAnswer }: GameProps) {
  const sequence = (game.payload as KeyCountPayload).sequence;
  const total = sequence.length;
  const [index, setIndex] = useState(0);
  const [miss, setMiss] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const palette = useContext(CaptchaPaletteContext);
  const accent = palette?.[0] ?? "#ffd23d";

  // Focus the control so keystrokes land here immediately.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const done = index >= total;
  const current = sequence[Math.min(index, total - 1)];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || done) return;
    if (e.key === ARROW_KEY[sequence[index]]) {
      // Correct arrow — record it and reveal the next one; the last press
      // auto-submits (no Enter needed).
      e.preventDefault();
      rec.key(`key-${sequence[index]}`, undefined, e.isTrusted);
      const next = index + 1;
      setIndex(next);
      if (next >= total) onAnswer({ pressed: total });
    } else if (e.key.startsWith("Arrow")) {
      // Wrong arrow — nudge, keep the same prompt.
      e.preventDefault();
      setMiss(true);
      setTimeout(() => setMiss(false), 400);
    }
  };

  return (
    <div
      ref={ref}
      role="group"
      aria-label={`Press each arrow key as it appears, ${total} in a row`}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={onKeyDown}
      className={cn(
        "relative flex size-full flex-col items-center justify-center gap-3 p-3 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring",
        miss && "hc-shake",
      )}
    >
      {/* The keyboard game's content is centered, so a busy theme backdrop (sun,
          grid) fights it. Sit it on a calm translucent panel — the theme still
          shows around the card, but the pixel arrow + counter read cleanly. */}
      <div className="relative flex flex-col items-center gap-3 rounded-xl border-2 border-white/15 bg-[#0a0e1c]/80 px-6 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_6px_18px_rgba(0,0,0,0.45)] backdrop-blur-[2px]">
        {/* Keyed on the step so it re-pops on every correct press — the feedback
            that the key registered and the next arrow is up. A soft accent glow
            sits behind it. */}
        <div key={index} className="hc-pop relative grid size-16 place-items-center" aria-hidden="true">
          <div
            className="absolute inset-0 rounded-full opacity-70 blur-md"
            style={{ background: `radial-gradient(circle, ${accent}66, transparent 60%)` }}
          />
          <div className="relative size-full">
            <PixelArrow direction={current} />
          </div>
        </div>
        {/* Progress pips: a little gem diamond per step — filled + glowing once
            done, the current one pulsing. */}
        <div className="flex gap-2" aria-hidden="true">
          {sequence.map((_, i) => (
            <span
              key={i}
              className={cn(
                "size-2.5 rotate-45 rounded-[1px] border transition-all",
                i === index && !done && "hc-pulse",
              )}
              style={{
                backgroundColor: i < index ? accent : "transparent",
                borderColor: i <= index ? accent : "rgba(255,255,255,0.28)",
                boxShadow: i < index ? `0 0 5px ${accent}99` : undefined,
              }}
            />
          ))}
        </div>
        <p className="hc-pixel text-[8px] leading-relaxed text-white/80" aria-hidden="true">
          {done ? "Done!" : `Press the ${current} arrow`}
        </p>
        {/* Full progress for screen readers (the visible copy stays short). */}
        <span className="sr-only" aria-live="polite">
          {done
            ? "All arrows pressed"
            : `Step ${index + 1} of ${total}: press the ${current} arrow`}
        </span>
      </div>
    </div>
  );
}
