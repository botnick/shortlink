import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ConnectPayload, ScenePoint } from "@shared/captcha";
import { cn } from "@/lib/utils";
import { HitArea, ShapeGlyph, distance, useGameSurface } from "../scene";
import type { GameProps } from "./types";

/** "Draw a line between the two diamonds" — one stroke, or select both pieces
 *  with the keyboard. */
export function ConnectGame({ game, rec, disabled, onAnswer }: GameProps) {
  const payload = game.payload as ConnectPayload;
  const { toScene, surfaceProps } = useGameSurface(rec);
  const [fromId, setFromId] = useState<string | null>(null);
  const [lineEnd, setLineEnd] = useState<ScenePoint | null>(null);
  const [kbFirst, setKbFirst] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [miss, setMiss] = useState(false);

  const from = payload.objects.find((o) => o.id === fromId);

  const shake = () => {
    setMiss(true);
    setTimeout(() => setMiss(false), 300);
  };

  const release = (p: ScenePoint) => {
    const start = fromId;
    setFromId(null);
    setLineEnd(null);
    if (!start) return;
    const target = payload.objects.find(
      (o) => o.id !== start && distance(p, o.pos) <= Math.max(o.size * 1.8, 8),
    );
    if (target) onAnswer({ a: start, b: target.id });
    else shake();
  };

  return (
    <div className={cn("size-full", miss && "hc-shake")}>
      <svg
        {...surfaceProps}
        onPointerMove={(e: ReactPointerEvent<SVGSVGElement>) => {
          if (fromId && !disabled) setLineEnd(toScene(e));
        }}
        onPointerUp={(e: ReactPointerEvent<SVGSVGElement>) => {
          if (fromId && !disabled) release(toScene(e));
        }}
        onPointerCancel={() => {
          setFromId(null);
          setLineEnd(null);
        }}
      >
        {from && lineEnd && (
          <line
            x1={from.pos.x}
            y1={from.pos.y}
            x2={lineEnd.x}
            y2={lineEnd.y}
            stroke="var(--primary)"
            strokeWidth={1.2}
            strokeLinecap="round"
            strokeDasharray="2.5 2"
          />
        )}
        {payload.objects.map((o) => (
          <ShapeGlyph
            key={o.id}
            obj={o}
            highlight={o.id === kbFirst || o.id === fromId}
          />
        ))}
        {payload.objects.map((o) => (
          <HitArea
            key={o.id}
            obj={o}
            label="game piece — press Enter to select"
            disabled={disabled}
            focused={focusedId === o.id}
            onFocusChange={(f) => setFocusedId(f ? o.id : null)}
            onPointerDown={(e) => {
              if (disabled) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setFromId(o.id);
              setLineEnd(o.pos);
            }}
            onActivate={(viaKeyboard) => {
              if (!viaKeyboard || disabled) return;
              if (!kbFirst) {
                setKbFirst(o.id);
                rec.key(o.id);
              } else if (kbFirst === o.id) {
                setKbFirst(null); // deselect
              } else {
                rec.key(o.id);
                onAnswer({ a: kbFirst, b: o.id });
              }
            }}
          />
        ))}
      </svg>
    </div>
  );
}
