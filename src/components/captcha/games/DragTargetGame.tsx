import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type { DragTargetPayload, ScenePoint } from "@shared/captcha";
import { cn } from "@/lib/utils";
import { HitArea, ShapeGlyph, distance, useGameSurface } from "../scene";
import type { GameProps } from "./types";

const KB_STEP = 3;
const clampPos = (v: number) => Math.min(96, Math.max(4, v));

/** "Drag the star into the dashed ring" — one drag, or pick-up/move/drop with
 *  the keyboard (Enter grabs, arrows move, Enter drops). */
export function DragTargetGame({ game, rec, disabled, onAnswer }: GameProps) {
  const payload = game.payload as DragTargetPayload;
  const { toScene, surfaceProps } = useGameSurface(rec);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<ScenePoint | null>(null);
  const [grabbed, setGrabbed] = useState<string | null>(null); // keyboard mode
  const [kbPos, setKbPos] = useState<ScenePoint | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [miss, setMiss] = useState(false);

  const ring = payload.ring;

  const shake = () => {
    setMiss(true);
    setTimeout(() => setMiss(false), 300);
  };

  const drop = (id: string, p: ScenePoint) => {
    if (distance(p, ring.pos) <= ring.size) {
      onAnswer({ objectId: id });
    } else {
      shake();
    }
  };

  const posFor = (id: string): ScenePoint | undefined => {
    if (id === dragId && dragPos) return dragPos;
    if (id === grabbed && kbPos) return kbPos;
    return undefined;
  };

  return (
    <div className={cn("size-full", miss && "hc-shake")}>
      <svg
        {...surfaceProps}
        onPointerMove={(e: ReactPointerEvent<SVGSVGElement>) => {
          if (dragId && !disabled) setDragPos(toScene(e));
        }}
        onPointerUp={(e: ReactPointerEvent<SVGSVGElement>) => {
          if (dragId && !disabled) {
            drop(dragId, toScene(e));
            setDragId(null);
            setDragPos(null);
          }
        }}
        onPointerCancel={() => {
          setDragId(null);
          setDragPos(null);
        }}
      >
        {/* Drop ring */}
        <circle
          cx={ring.pos.x}
          cy={ring.pos.y}
          r={ring.size}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={0.9}
          strokeDasharray="3 2.4"
          opacity={0.75}
        />
        {payload.objects.map((o) => (
          <ShapeGlyph key={o.id} obj={o} pos={posFor(o.id)} highlight={o.id === grabbed} />
        ))}
        {payload.objects.map((o) => (
          <HitArea
            key={o.id}
            obj={o}
            pos={posFor(o.id)}
            label="game piece — press Enter to pick up, arrows to move, Enter to drop"
            disabled={disabled}
            focused={focusedId === o.id}
            onFocusChange={(f) => setFocusedId(f ? o.id : null)}
            onPointerDown={(e) => {
              if (disabled) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragId(o.id);
              setDragPos(toScene(e));
            }}
            onActivate={(viaKeyboard) => {
              if (!viaKeyboard || disabled) return; // pointer flow is drag-only
              if (grabbed === o.id && kbPos) {
                rec.key(o.id, kbPos);
                drop(o.id, kbPos);
                setGrabbed(null);
                setKbPos(null);
              } else {
                setGrabbed(o.id);
                setKbPos(o.pos);
                rec.key(o.id, o.pos);
              }
            }}
            onKey={(key) => {
              if (grabbed !== o.id || !kbPos) return false;
              const d: Record<string, [number, number]> = {
                ArrowLeft: [-KB_STEP, 0],
                ArrowRight: [KB_STEP, 0],
                ArrowUp: [0, -KB_STEP],
                ArrowDown: [0, KB_STEP],
              };
              const move = d[key];
              if (!move) return false;
              const next = {
                x: clampPos(kbPos.x + move[0]),
                y: clampPos(kbPos.y + move[1]),
              };
              setKbPos(next);
              rec.key(o.id, next);
              return true;
            }}
          />
        ))}
      </svg>
    </div>
  );
}
