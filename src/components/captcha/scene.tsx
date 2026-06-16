/**
 * Shared SVG scene primitives for the human-check games. Everything renders in
 * a 100×100 viewBox, so layouts scale from a 320px phone to a desktop without
 * any per-device math — the same normalized coordinates the server validated
 * the challenge in.
 */
import { useContext, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { SceneObject, ScenePoint } from "@shared/captcha";
import { SCENE_H, SCENE_W } from "@shared/captcha";
import type { EvidenceRecorder } from "@/lib/captcha";
import { darken, lighten, pixelate } from "@/lib/pixel";
import { CaptchaPaletteContext } from "./themes";

/** Per-piece raster recipe: a random cell count (12–14) + sub-cell offset so the
 *  SAME shape rasterizes to a DIFFERENT pixel pattern every challenge —
 *  defeating a "hash the rendered sprite once" bot. Stable for the piece's
 *  lifetime; same clean silhouette either way. */
function rasterFor(): { n: number; ox: number; oy: number } {
  return {
    n: 12 + Math.floor(Math.random() * 3),
    ox: Math.random() * 0.8 - 0.4,
    oy: Math.random() * 0.8 - 0.4,
  };
}

/** Deterministic colour for a piece from the active theme palette (stable per
 *  id). Color is decorative only, so recoloring never affects validation. */
export function usePieceColor(id: string, serverColor: string): string {
  const palette = useContext(CaptchaPaletteContext);
  if (!palette || palette.length === 0) return serverColor;
  const h = parseInt(id.slice(0, 6), 16) || 0;
  return palette[h % palette.length];
}


/** One game piece, painted as a crisp pixel-art sprite. The server still sends
 *  geometry as a jittered vertex polygon with NO shape name — we just rasterize
 *  it to a pixel grid client-side for looks, so the bot/human asymmetry is
 *  preserved (a person sees a star, a script sees an anonymous vertex list). */
export function ShapeGlyph({
  obj,
  pos,
  faded = false,
  highlight = false,
}: {
  obj: SceneObject;
  /** Override position (e.g. while being dragged). */
  pos?: ScenePoint;
  faded?: boolean;
  highlight?: boolean;
}) {
  const p = pos ?? obj.pos;
  const color = usePieceColor(obj.id, obj.color);
  // Cut-gem shading: a hard dark outline + a 5-step facet ramp lit from the
  // top-left + a sharp specular glint, so the jittered polygon reads as a crisp,
  // glossy pixel jewel (no soft glow — that just made it look like a blob).
  const edgeColor = useMemo(() => darken(color, 0.64), [color]); // hard outline
  const ramp = useMemo(
    () => [
      lighten(color, 0.52), // brightest facet (top-left)
      lighten(color, 0.24),
      color,
      darken(color, 0.2),
      darken(color, 0.42), // deepest facet (bottom-right)
    ],
    [color],
  );
  const specColor = useMemo(() => lighten(color, 0.85), [color]); // glint

  // Per-piece raster recipe (random cell count + sub-cell offset) → the SAME
  // shape rasterizes to a DIFFERENT bitmap each challenge, so a bot can't hash
  // the rendered sprite once. Stable for the piece's lifetime.
  const raster = useMemo(() => rasterFor(), [obj.id]);
  const cells = useMemo(
    () => pixelate(obj.poly, obj.round, raster.n, raster.ox, raster.oy),
    [obj.poly, obj.round, raster],
  );
  // Merge the filled cells into THREE <path>s (base / edge / top-bevel) instead
  // of ~150 <rect>s per piece — same look, far fewer DOM nodes on mobile.
  const paths = useMemo(() => {
    const px = (obj.size * 2) / raster.n;
    const w = (px * 1.03).toFixed(2);
    const xs = cells.map((c) => c.gx);
    const ys = cells.map((c) => c.gy);
    const minX = Math.min(...xs);
    const spanX = Math.max(1, Math.max(...xs) - minX);
    const minY = Math.min(...ys);
    const spanY = Math.max(1, Math.max(...ys) - minY);
    // The 1–2 cells nearest the top-left become a specular glint.
    const sorted = [...cells].sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
    const spec = new Set(sorted.slice(0, cells.length > 80 ? 2 : 1).map((c) => `${c.gx},${c.gy}`));
    const tiers = ["", "", "", "", ""];
    let outline = "", glint = "";
    for (const c of cells) {
      const x = (-obj.size + c.gx * px).toFixed(2);
      const y = (-obj.size + c.gy * px).toFixed(2);
      const seg = `M${x} ${y}h${w}v${w}h-${w}z`;
      const key = `${c.gx},${c.gy}`;
      if (spec.has(key)) {
        glint += seg;
      } else if (c.edge && !c.topEdge) {
        outline += seg; // hard dark rim on the sides + bottom
      } else {
        // Brightness from the top-left: facet ramp index 0 (bright) … 4 (dark).
        const score = (1 - (c.gy - minY) / spanY) * 0.6 + (1 - (c.gx - minX) / spanX) * 0.4;
        tiers[Math.min(4, Math.max(0, Math.round((1 - score) * 4)))] += seg;
      }
    }
    return { outline, tiers, glint };
  }, [cells, obj.size, raster.n]);

  return (
    <g transform={`translate(${p.x} ${p.y})`} opacity={faded ? 0.45 : 1}>
      {/* Contact shadow — grounds the piece and stays put while it bobs above. */}
      <ellipse cy={obj.size * 1.28} rx={obj.size * 0.92} ry={obj.size * 0.3} fill="#000" opacity={0.34} />
      {/* Idle bob (decorative; CSS-disabled under prefers-reduced-motion). */}
      <g
        className="hc-bob"
        style={{ animationDelay: `${(-(obj.phase / (Math.PI * 2)) * 3.6).toFixed(2)}s` }}
      >
        {highlight && (
          <circle
            className="hc-pulse"
            r={obj.size * 1.5}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={1.1}
            strokeDasharray="2.6 2"
          />
        )}
        {paths.outline && <path d={paths.outline} fill={edgeColor} shapeRendering="crispEdges" />}
        {paths.tiers.map((d, i) =>
          d ? <path key={i} d={d} fill={ramp[i]} shapeRendering="crispEdges" /> : null,
        )}
        {paths.glint && (
          <path d={paths.glint} className="hc-glint" fill={specColor} shapeRendering="crispEdges" />
        )}
        {obj.label && (
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={obj.size * 1.05}
            fontWeight={600}
            fill="#fff"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {obj.label}
          </text>
        )}
      </g>
    </g>
  );
}

/**
 * Invisible, generously sized hit area + keyboard focus target for a piece.
 * The circle guarantees a ≥44px touch target at the widget's minimum width
 * even when the visible shape is smaller.
 */
export function HitArea({
  obj,
  pos,
  label,
  disabled = false,
  focused = false,
  onActivate,
  onKey,
  onFocusChange,
  onPointerDown,
}: {
  obj: SceneObject;
  pos?: ScenePoint;
  label: string;
  disabled?: boolean;
  focused?: boolean;
  /** Tap / Enter / Space. `viaKeyboard` lets callers log a key event. */
  onActivate?: (viaKeyboard: boolean) => void;
  /** Non-activation keys (arrows etc.). Return true when handled. */
  onKey?: (key: string) => boolean;
  onFocusChange?: (focused: boolean) => void;
  onPointerDown?: (e: ReactPointerEvent<SVGGElement>) => void;
}) {
  const p = pos ?? obj.pos;
  const r = Math.max(obj.size * 1.6, 8);
  return (
    <g
      transform={`translate(${p.x} ${p.y})`}
      role="button"
      aria-label={label}
      tabIndex={disabled ? -1 : 0}
      style={{ outline: "none", cursor: disabled ? "default" : "pointer" }}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
      onPointerDown={onPointerDown}
      onClick={disabled ? undefined : () => onActivate?.(false)}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate?.(true);
        } else if (onKey?.(e.key)) {
          e.preventDefault();
        }
      }}
    >
      {focused && (
        <circle r={r} fill="none" stroke="var(--ring)" strokeWidth={0.8} strokeDasharray="2 1.6" />
      )}
      <circle r={r} fill="transparent" />
    </g>
  );
}

/** Scene-coordinate conversion + capture-phase evidence recording for an svg. */
export function useGameSurface(rec: EvidenceRecorder) {
  const ref = useRef<SVGSVGElement>(null);

  const toScene = (e: { clientX: number; clientY: number }): ScenePoint => {
    const el = ref.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(SCENE_W + 5, Math.max(-5, ((e.clientX - r.left) / r.width) * SCENE_W)),
      y: Math.min(SCENE_H + 5, Math.max(-5, ((e.clientY - r.top) / r.height) * SCENE_H)),
    };
  };

  const surfaceProps = {
    ref,
    viewBox: `0 0 ${SCENE_W} ${SCENE_H}`,
    className: "size-full touch-none select-none",
    onPointerDownCapture: (e: ReactPointerEvent<SVGSVGElement>) =>
      rec.pointer("pointer-down", toScene(e), e.pointerType, e.isTrusted),
    onPointerMoveCapture: (e: ReactPointerEvent<SVGSVGElement>) =>
      rec.pointer("pointer-move", toScene(e), e.pointerType, e.isTrusted),
    onPointerUpCapture: (e: ReactPointerEvent<SVGSVGElement>) =>
      rec.pointer("pointer-up", toScene(e), e.pointerType, e.isTrusted),
  } as const;

  return { ref, toScene, surfaceProps };
}

export function distance(a: ScenePoint, b: ScenePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
