import { useState } from "react";
import type { SceneObject, TapMatchPayload } from "@shared/captcha";
import { HitArea, ShapeGlyph, useGameSurface } from "../scene";
import type { GameProps } from "./types";

/** "Tap the star" — one tap (or Tab + Enter). */
export function TapMatchGame({ game, rec, disabled, onAnswer }: GameProps) {
  const payload = game.payload as TapMatchPayload;
  const { surfaceProps } = useGameSurface(rec);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const activate = (obj: SceneObject, viaKeyboard: boolean) => {
    if (disabled) return;
    if (viaKeyboard) rec.key(obj.id);
    onAnswer({ objectId: obj.id });
  };

  return (
    <div className="size-full">
      <svg {...surfaceProps}>
        {payload.objects.map((o) => (
          <ShapeGlyph key={o.id} obj={o} />
        ))}
        {payload.objects.map((o) => (
          <HitArea
            key={o.id}
            obj={o}
            label="game piece"
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
