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
  const edgeColor = useMemo(() => darken(color, 0.45), [color]);
  const topColor = useMemo(() => lighten(color, 0.34), [color]);

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
    let base = "", edge = "", top = "";
    for (const c of cells) {
      const x = (-obj.size + c.gx * px).toFixed(2);
      const y = (-obj.size + c.gy * px).toFixed(2);
      const seg = `M${x} ${y}h${w}v${w}h-${w}z`;
      if (c.topEdge) top += seg;
      else if (c.edge) edge += seg;
      else base += seg;
    }
    return { base, edge, top };
  }, [cells, obj.size, raster.n]);

  return (
    <g transform={`translate(${p.x} ${p.y})`} opacity={faded ? 0.45 : 1}>
      {/* Idle bob (decorative; CSS-disabled under prefers-reduced-motion). */}
      <g
        className="hc-bob"
        style={{ animationDelay: `${(-(obj.phase / (Math.PI * 2)) * 3.6).toFixed(2)}s` }}
      >
        {highlight && (
          <circle
            r={obj.size * 1.5}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={1.1}
            strokeDasharray="2.6 2"
          />
        )}
        {paths.base && <path d={paths.base} fill={color} shapeRendering="crispEdges" />}
        {paths.edge && <path d={paths.edge} fill={edgeColor} shapeRendering="crispEdges" />}
        {paths.top && <path d={paths.top} fill={topColor} shapeRendering="crispEdges" />}
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
