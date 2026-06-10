import { useState } from "react";
import type { SceneObject, SortPayload } from "@shared/captcha";
import { HitArea, ShapeGlyph, useGameSurface } from "../scene";
import type { GameProps } from "./types";

/** "Tap the stars from smallest to largest" — three taps, in your order. Every
 *  piece is sortable (no decoys); the client only collects the tap order and
 *  has no idea whether it's right — the server checks it against the sizes. */
export function SortGame({ game, rec, disabled, onAnswer }: GameProps) {
  const payload = game.payload as SortPayload;
  const { surfaceProps } = useGameSurface(rec);
  const [picked, setPicked] = useState<string[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const activate = (obj: SceneObject, viaKeyboard: boolean) => {
    if (disabled || picked.includes(obj.id)) return;
    if (viaKeyboard) rec.key(obj.id);
    const next = [...picked, obj.id];
    setPicked(next);
    if (next.length === payload.objects.length) onAnswer({ order: next });
  };

  return (
    <div className="size-full">
      <svg {...surfaceProps}>
        {payload.objects.map((o) => (
          <ShapeGlyph key={o.id} obj={o} highlight={picked.includes(o.id)} />
        ))}
        {/* Order badges on picked pieces */}
        {picked.map((id, i) => {
          const o = payload.objects.find((x) => x.id === id);
          if (!o) return null;
          return (
            <g
              key={id}
              transform={`translate(${o.pos.x + o.size * 0.9} ${o.pos.y - o.size * 0.9})`}
            >
              <circle r={3.4} fill="var(--primary)" />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={4}
                fontWeight={700}
                fill="#fff"
                style={{ pointerEvents: "none" }}
              >
                {i + 1}
              </text>
            </g>
          );
        })}
        {payload.objects.map((o) => (
          <HitArea
            key={o.id}
            obj={o}
            label={`game piece, size ${Math.round(o.size * 10)}`}
            disabled={disabled}
            focused={focusedId === o.id}
            onFocusChange={(f) => setFocusedId(f ? o.id : null)}
            onActivate={(viaKeyboard) => activate(o, viaKeyboard)}
          />
        ))}
      </svg>
    </div>
  );
}
