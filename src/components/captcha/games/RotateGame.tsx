import { useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { RotatePayload } from "@shared/captcha";
import { cn } from "@/lib/utils";
import { useGameSurface, usePieceColor } from "../scene";
import type { GameProps } from "./types";

const ALIGN_DEG = 12; // client-side "feels aligned" check (UX only — the
// server holds the real tolerance and validates the submitted angle itself)

function angDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** "Turn the arrow to point at the dot" — drag around the pivot, or arrow keys
 *  then Enter. Submits when the arrow is released roughly on target. */
export function RotateGame({ game, rec, disabled, onAnswer }: GameProps) {
  const payload = game.payload as RotatePayload;
  const { toScene, surfaceProps } = useGameSurface(rec);
  const { arrow, dot } = payload;
  const arrowColor = usePieceColor(game.id, arrow.color);
  const [angle, setAngle] = useState(arrow.angle);
  const [dragging, setDragging] = useState(false);
  const [miss, setMiss] = useState(false);

  const center = arrow.pos;
  const rad = (dot.angle * Math.PI) / 180;
  const dotPos = {
    x: center.x + Math.cos(rad) * dot.radius,
    y: center.y + Math.sin(rad) * dot.radius,
  };

  const pointTo = (e: { clientX: number; clientY: number }) => {
    const p = toScene(e);
    return (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;
  };

  const submitIfAligned = (a: number) => {
    if (angDiff(a, dot.angle) <= ALIGN_DEG) {
      onAnswer({ angle: ((a % 360) + 360) % 360 });
    } else {
      setMiss(true);
      setTimeout(() => setMiss(false), 300);
    }
  };

  return (
    <div className={cn("size-full", miss && "hc-shake")}>
      <svg
        {...surfaceProps}
        role="slider"
        aria-label="Turn the arrow to point at the dot"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(((angle % 360) + 360) % 360)}
        tabIndex={disabled ? -1 : 0}
        style={{ outline: "none", cursor: disabled ? "default" : "grab" }}
        onPointerDown={(e: ReactPointerEvent<SVGSVGElement>) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          setAngle(pointTo(e));
        }}
        onPointerMove={(e) => {
          if (dragging && !disabled) setAngle(pointTo(e));
        }}
        onPointerUp={() => {
          if (!dragging || disabled) return;
          setDragging(false);
          submitIfAligned(angle);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e: KeyboardEvent<SVGSVGElement>) => {
          if (disabled) return;
          const step =
            e.key === "ArrowRight" || e.key === "ArrowDown"
              ? 6
              : e.key === "ArrowLeft" || e.key === "ArrowUp"
                ? -6
                : 0;
          if (step !== 0) {
            e.preventDefault();
            rec.key("arrow");
            setAngle((a) => a + step);
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            rec.key("arrow");
            submitIfAligned(angle);
          }
        }}
      >
        {/* Guide ring + target dot */}
        <circle
          cx={center.x}
          cy={center.y}
          r={dot.radius}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={0.5}
          opacity={0.35}
        />
        <g className="hc-bob">
          <circle cx={dotPos.x} cy={dotPos.y} r={dot.size} fill={dot.color} />
          <circle
            cx={dotPos.x}
            cy={dotPos.y}
            r={dot.size + 2.2}
            fill="none"
            stroke={dot.color}
            strokeWidth={0.6}
            opacity={0.5}
          />
        </g>
        {/* Arrow */}
        <g transform={`translate(${center.x} ${center.y}) rotate(${angle})`}>
          <g transform={`scale(${arrow.size})`}>
            <path
              d="M -0.55 -0.2 L 0.3 -0.2 L 0.3 -0.42 L 0.95 0 L 0.3 0.42 L 0.3 0.2 L -0.55 0.2 Z"
              fill={arrowColor}
            />
          </g>
          <circle r={2.4} fill="#0a0e1c" stroke={arrowColor} strokeWidth={0.9} />
        </g>
      </svg>
    </div>
  );
}
