import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PathTracePayload, SceneObject } from "@shared/captcha";
import { cn } from "@/lib/utils";
import { HitArea, ShapeGlyph, distance, useGameSurface } from "../scene";
import type { GameProps } from "./types";

/** "Drag through the dots in order" — one continuous stroke 1→2→3(→4), or
 *  activate the dots in order with the keyboard. Releasing early just resets
 *  the visual progress; nothing is submitted until the trace completes. */
export function PathTraceGame({ game, rec, disabled, onAnswer, tolerance }: GameProps) {
  const payload = game.payload as PathTracePayload;
  const { toScene, surfaceProps } = useGameSurface(rec);
  const [progress, setProgress] = useState(0);
  const [tracing, setTracing] = useState(false);
  const [kbProgress, setKbProgress] = useState(0);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [miss, setMiss] = useState(false);

  const ordered = useMemo(
    () =>
      [...payload.dots].sort((a, b) => Number(a.label ?? 0) - Number(b.label ?? 0)),
    [payload.dots],
  );
  const hitR = (d: SceneObject) => Math.max(d.size * 2, 8) * tolerance;

  const done = Math.max(progress, kbProgress);

  const submit = () => onAnswer({ order: ordered.map((d) => d.id) });

  return (
    <div className={cn("size-full", miss && "hc-shake")}>
      <svg
        {...surfaceProps}
        onPointerDown={(e: ReactPointerEvent<SVGSVGElement>) => {
          if (disabled) return;
          const p = toScene(e);
          if (distance(p, ordered[0].pos) <= hitR(ordered[0])) {
            e.currentTarget.setPointerCapture(e.pointerId);
            setTracing(true);
            setProgress(1);
          }
        }}
        onPointerMove={(e) => {
          if (!tracing || disabled) return;
          const next = ordered[progress];
          if (next && distance(toScene(e), next.pos) <= hitR(next)) {
            setProgress((n) => n + 1);
          }
        }}
        onPointerUp={(e) => {
          if (!tracing || disabled) return;
          setTracing(false);
          // Count the dot under the release point too, so lifting your finger
          // right on the last dot still completes the stroke (coarse touch
          // often fires no final pointermove there).
          let reached = progress;
          const last = ordered[reached];
          if (last && distance(toScene(e), last.pos) <= hitR(last)) reached += 1;
          if (reached >= ordered.length) submit();
          else setProgress(0); // no penalty — just try the stroke again
        }}
        onPointerCancel={() => {
          setTracing(false);
          setProgress(0);
        }}
      >
        {/* Faint guide through the dots in order */}
        <polyline
          points={ordered.map((d) => `${d.pos.x},${d.pos.y}`).join(" ")}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={0.6}
          strokeDasharray="2 2.4"
          opacity={0.4}
        />
        {/* Completed segments */}
        {done > 1 && (
          <polyline
            points={ordered
              .slice(0, done)
              .map((d) => `${d.pos.x},${d.pos.y}`)
              .join(" ")}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={1.3}
            strokeLinecap="round"
          />
        )}
        {payload.dots.map((o) => (
          <ShapeGlyph
            key={o.id}
            obj={o}
            faded={ordered.indexOf(o) >= done}
            highlight={ordered.indexOf(o) < done}
          />
        ))}
        {payload.dots.map((o) => (
          <HitArea
            key={o.id}
            obj={o}
            label={`dot ${o.label ?? ""} of ${ordered.length}`}
            disabled={disabled}
            focused={focusedId === o.id}
            onFocusChange={(f) => setFocusedId(f ? o.id : null)}
            onActivate={(viaKeyboard) => {
              if (!viaKeyboard || disabled) return;
              if (ordered[kbProgress]?.id === o.id) {
                rec.key(o.id);
                const n = kbProgress + 1;
                setKbProgress(n);
                if (n >= ordered.length) submit();
              } else {
                rec.key(o.id);
                setMiss(true);
                setTimeout(() => setMiss(false), 300);
              }
            }}
          />
        ))}
      </svg>
    </div>
  );
}
