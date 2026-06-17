import { useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { SlidePayload } from "@shared/captcha";
import { SCENE_H } from "@shared/captcha";
import { cn } from "@/lib/utils";
import { darken, lighten } from "@/lib/pixel";
import { useGameSurface, usePieceColor } from "../scene";
import type { GameProps } from "./types";

const ALIGN = 7; // client "looks aligned" feel (server holds the real tolerance)
const KB_STEP = 3;
const clampPos = (v: number) => Math.min(100, Math.max(0, v));

/** A chunky pixel handle on a track; slide it into the notch. Pointer drag or
 *  arrow keys. The visible style is pixel-art; the maths is the same 0–100 the
 *  server validated. */
export function SlideGame({ game, rec, disabled, onAnswer, tolerance }: GameProps) {
  const payload = game.payload as SlidePayload;
  const { ref, toScene, surfaceProps } = useGameSurface(rec);
  const [pos, setPos] = useState(8);
  const [drag, setDrag] = useState(false);
  const [miss, setMiss] = useState(false);

  const TRACK_Y = SCENE_H / 2;
  const trackXToPos = (e: { clientX: number; clientY: number }) => clampPos(toScene(e).x);

  const release = (p: number) => {
    setDrag(false);
    if (Math.abs(p - payload.target) <= ALIGN * tolerance) onAnswer({ pos: p });
    else {
      setMiss(true);
      setTimeout(() => {
        setMiss(false);
        setPos(8);
      }, 400);
    }
  };

  const color = usePieceColor(game.id, payload.color);
  // Build a chunky pixel handle (6 cells tall, crisp).
  const handleW = 7;
  const handleH = 16;

  return (
    <div className={cn("size-full", miss && "hc-shake")}>
      <svg
        {...surfaceProps}
        ref={ref}
        role="slider"
        aria-label="Slide the handle into the notch"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        tabIndex={disabled ? -1 : 0}
        style={{ outline: "none", cursor: disabled ? "default" : "grab" }}
        onPointerDown={(e: ReactPointerEvent<SVGSVGElement>) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(true);
          setPos(trackXToPos(e));
        }}
        onPointerMove={(e) => {
          if (drag && !disabled) setPos(trackXToPos(e));
        }}
        onPointerUp={(e) => {
          if (!drag || disabled) return;
          const p = trackXToPos(e); // judge the released point, not stale state
          setPos(p);
          release(p);
        }}
        onPointerCancel={() => setDrag(false)}
        onKeyDown={(e: KeyboardEvent<SVGSVGElement>) => {
          if (disabled) return;
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            rec.key("slide");
            setPos((p) => clampPos(p + (e.key === "ArrowRight" ? KB_STEP : -KB_STEP)));
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            rec.key("slide");
            release(pos);
          }
        }}
      >
        {/* Track groove — pixel blocks */}
        {Array.from({ length: 24 }).map((_, i) => (
          <rect
            key={i}
            x={4 + i * 3.84}
            y={TRACK_Y - 3}
            width={3.4}
            height={6}
            fill={i % 2 === 0 ? "var(--muted)" : "var(--muted-foreground)"}
            opacity={0.35}
            shapeRendering="crispEdges"
          />
        ))}
        {/* Notch / target — a dashed pixel slot */}
        <g transform={`translate(${payload.target} ${TRACK_Y})`}>
          <rect x={-5} y={-9} width={10} height={18} fill="none" stroke={darken(color, 0.2)} strokeWidth={1.4} strokeDasharray="2 2" shapeRendering="crispEdges" />
        </g>
        {/* Handle — chunky pixel block with light/dark bevel */}
        <g transform={`translate(${pos} ${TRACK_Y})`}>
          <rect x={-handleW / 2 - 1} y={-handleH / 2 - 1} width={handleW + 2} height={handleH + 2} fill={darken(color, 0.5)} shapeRendering="crispEdges" />
          <rect x={-handleW / 2} y={-handleH / 2} width={handleW} height={handleH} fill={color} shapeRendering="crispEdges" />
          <rect x={-handleW / 2} y={-handleH / 2} width={handleW} height={2.2} fill={lighten(color, 0.4)} shapeRendering="crispEdges" />
          <rect x={-handleW / 2} y={handleH / 2 - 2.2} width={handleW} height={2.2} fill={darken(color, 0.3)} shapeRendering="crispEdges" />
          {/* grip dots */}
          {[-3, 0, 3].map((dy) => (
            <rect key={dy} x={-1} y={dy - 0.6} width={2} height={1.2} fill={darken(color, 0.35)} shapeRendering="crispEdges" />
          ))}
        </g>
      </svg>
    </div>
  );
}
