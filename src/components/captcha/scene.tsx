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


const GEM_SHAPES = [
  "diamond", "star", "heart", "hexagon", "circle", "triangle", "square", "plus",
] as const;
type GemShape = (typeof GEM_SHAPES)[number];

/** Classify the server's nameless jittered polygon into a gem shape — purely to
 *  pick a pretty sprite. This runs ENTIRELY client-side from geometry the client
 *  already received, so nothing extra crosses the wire and the bot/human
 *  asymmetry is unchanged (a script already reads the raw vertex list). Returns
 *  null for anything unexpected, which falls back to the procedural painter. */
function classifyGem(poly: ScenePoint[] | undefined, round: boolean | undefined): GemShape | null {
  if (round) return "circle";
  if (!poly) return null;
  const n = poly.length;
  if (n === 3) return "triangle";
  if (n === 6) return "hexagon";
  if (n === 10) return "star";
  if (n === 12) return "plus";
  if (n >= 16) return "heart";
  if (n === 4) {
    // Diamond (a vertex points straight up, over the centre) vs square (a flat
    // top edge of two off-centre corners).
    const cx = poly.reduce((s, q) => s + q.x, 0) / n;
    const xs = poly.map((q) => q.x);
    const halfW = (Math.max(...xs) - Math.min(...xs)) / 2 || 1;
    const top = poly.reduce((a, b) => (b.y < a.y ? b : a));
    return Math.abs(top.x - cx) < 0.35 * halfW ? "diamond" : "square";
  }
  return null;
}

/** One game piece. The server sends a jittered vertex polygon with NO shape name;
 *  we classify it client-side and paint a matching pixel-art gem sprite (or, for
 *  an unrecognised polygon, the procedural faceted painter). The silhouette a
 *  person reads is the same the server validated. */
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
  const gem = classifyGem(obj.poly, obj.round);
  const s = obj.size * 1.16;

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
        {gem ? (
          <image
            href={`/captcha-gems/${gem}.webp`}
            x={-s}
            y={-s}
            width={s * 2}
            height={s * 2}
            preserveAspectRatio="xMidYMid meet"
          />
        ) : (
          <ProceduralGem obj={obj} />
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

/** Fallback painter for an unrecognised polygon: a crisp faceted pixel jewel
 *  rasterised straight from the server's vertices (hard outline + 5-step
 *  top-left facet ramp + specular glint). */
function ProceduralGem({ obj }: { obj: SceneObject }) {
  const color = usePieceColor(obj.id, obj.color);
  const edgeColor = useMemo(() => darken(color, 0.64), [color]);
  const ramp = useMemo(
    () => [
      lighten(color, 0.52),
      lighten(color, 0.24),
      color,
      darken(color, 0.2),
      darken(color, 0.42),
    ],
    [color],
  );
  const specColor = useMemo(() => lighten(color, 0.85), [color]);
  const raster = useMemo(() => rasterFor(), [obj.id]);
  const cells = useMemo(
    () => pixelate(obj.poly, obj.round, raster.n, raster.ox, raster.oy),
    [obj.poly, obj.round, raster],
  );
  const paths = useMemo(() => {
    const px = (obj.size * 2) / raster.n;
    const w = (px * 1.03).toFixed(2);
    const xs = cells.map((c) => c.gx);
    const ys = cells.map((c) => c.gy);
    const minX = Math.min(...xs);
    const spanX = Math.max(1, Math.max(...xs) - minX);
    const minY = Math.min(...ys);
    const spanY = Math.max(1, Math.max(...ys) - minY);
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
        outline += seg;
      } else {
        const score = (1 - (c.gy - minY) / spanY) * 0.6 + (1 - (c.gx - minX) / spanX) * 0.4;
        tiers[Math.min(4, Math.max(0, Math.round((1 - score) * 4)))] += seg;
      }
    }
    return { outline, tiers, glint };
  }, [cells, obj.size, raster.n]);

  return (
    <>
      {paths.outline && <path d={paths.outline} fill={edgeColor} shapeRendering="crispEdges" />}
      {paths.tiers.map((d, i) =>
        d ? <path key={i} d={d} fill={ramp[i]} shapeRendering="crispEdges" /> : null,
      )}
      {paths.glint && (
        <path d={paths.glint} className="hc-glint" fill={specColor} shapeRendering="crispEdges" />
      )}
    </>
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
