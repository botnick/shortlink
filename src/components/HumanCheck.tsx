import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { solvePow } from "@/lib/pow";
import { useConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

/** Everything the server needs to verify the human check. */
export interface HumanPayload {
  challenge: string;
  solution: string;
  gamePos?: number;
  gameDuration?: number;
  gameMoves?: number;
}

const TOLERANCE = 4; // keep in sync with the server's GAME_TOLERANCE

/** Read the game target/variant out of the (signed) challenge for rendering. */
function challengeMeta(challenge: string): { g: number; m: number } {
  try {
    const p = JSON.parse(
      decodeURIComponent(escape(atob(challenge.split(".")[0]))),
    ) as { g?: number; m?: number };
    return {
      g: typeof p.g === "number" ? p.g : 50,
      m: typeof p.m === "number" ? p.m : 0,
    };
  } catch {
    return { g: 50, m: 0 };
  }
}

interface GameResult {
  pos: number;
  duration: number;
  moves: number;
}

interface GameProps {
  target: number;
  solved: boolean;
  onSolve: (r: GameResult) => void;
}

/** Track interaction telemetry shared by every game. */
function useTelemetry() {
  const startAt = useRef(0);
  const moves = useRef(0);
  return {
    begin() {
      if (!startAt.current) startAt.current = Date.now();
    },
    move() {
      moves.current++;
    },
    result(pos: number): GameResult {
      return {
        pos: Math.round(pos * 10) / 10,
        duration: Math.max(1, Date.now() - startAt.current),
        moves: moves.current,
      };
    },
  };
}

/** Position (0–100) of a pointer event inside an element. */
function pctIn(el: HTMLElement, clientX: number): number {
  const rect = el.getBoundingClientRect();
  return Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
}

const LANE =
  "relative h-11 w-full touch-none select-none overflow-hidden rounded-lg border bg-muted/50 outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Game 0 — drag the piece into the dashed slot. */
function SlideGame({ target, solved, onSolve }: GameProps) {
  const lane = useRef<HTMLDivElement>(null);
  const tel = useTelemetry();
  const [pos, setPos] = useState(6);
  const [drag, setDrag] = useState(false);
  const [miss, setMiss] = useState(false);
  const shown = solved ? target : pos;

  function release(p: number) {
    setDrag(false);
    if (Math.abs(p - target) <= TOLERANCE) onSolve(tel.result(p));
    else {
      setMiss(true);
      setTimeout(() => {
        setMiss(false);
        setPos(6);
      }, 300);
    }
  }

  return (
    <div
      ref={lane}
      role="slider"
      aria-label="Drag the piece into the dashed slot"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown)}
      tabIndex={solved ? -1 : 0}
      className={cn(LANE, !solved && "cursor-grab", drag && "cursor-grabbing", miss && "hc-shake")}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        if (solved) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        tel.begin();
        setDrag(true);
        setPos(pctIn(lane.current!, e.clientX));
      }}
      onPointerMove={(e) => {
        if (!drag || solved) return;
        tel.move();
        setPos(pctIn(lane.current!, e.clientX));
      }}
      onPointerUp={(e) => drag && !solved && release(pctIn(lane.current!, e.clientX))}
      onPointerCancel={() => drag && release(pos)}
      onKeyDown={(e: KeyboardEvent) => {
        if (solved) return;
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          tel.begin();
          tel.move();
          setPos((p) => Math.min(100, Math.max(0, p + (e.key === "ArrowRight" ? 2 : -2))));
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          release(pos);
        }
      }}
    >
      {/* dashed slot */}
      <div
        className="absolute top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-dashed border-foreground/30"
        style={{ left: `${target}%` }}
      />
      {/* piece */}
      <div
        className={cn(
          "absolute top-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md shadow-sm ring-1 ring-black/10",
          solved ? "bg-emerald-500" : "bg-primary",
          !drag && "transition-[left] duration-200 ease-out",
        )}
        style={{ left: `${shown}%` }}
      >
        {solved ? (
          <Check className="size-4 text-white" />
        ) : (
          <span className="grid grid-cols-2 gap-0.5 opacity-80">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="size-1 rounded-full bg-white/90" />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/** Game 1 — drag the needle to the ▼ marker on a ruler. */
function DialGame({ target, solved, onSolve }: GameProps) {
  const lane = useRef<HTMLDivElement>(null);
  const tel = useTelemetry();
  const [pos, setPos] = useState(8);
  const [drag, setDrag] = useState(false);
  const [miss, setMiss] = useState(false);
  const shown = solved ? target : pos;

  function release(p: number) {
    setDrag(false);
    if (Math.abs(p - target) <= TOLERANCE) onSolve(tel.result(p));
    else {
      setMiss(true);
      setTimeout(() => {
        setMiss(false);
        setPos(8);
      }, 300);
    }
  }

  return (
    <div
      ref={lane}
      role="slider"
      aria-label="Drag the needle to the marker"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown)}
      tabIndex={solved ? -1 : 0}
      className={cn(LANE, !solved && "cursor-ew-resize", miss && "hc-shake")}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        if (solved) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        tel.begin();
        setDrag(true);
        setPos(pctIn(lane.current!, e.clientX));
      }}
      onPointerMove={(e) => {
        if (!drag || solved) return;
        tel.move();
        setPos(pctIn(lane.current!, e.clientX));
      }}
      onPointerUp={(e) => drag && !solved && release(pctIn(lane.current!, e.clientX))}
      onPointerCancel={() => drag && release(pos)}
      onKeyDown={(e: KeyboardEvent) => {
        if (solved) return;
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          tel.begin();
          tel.move();
          setPos((p) => Math.min(100, Math.max(0, p + (e.key === "ArrowRight" ? 2 : -2))));
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          release(pos);
        }
      }}
    >
      {/* ruler ticks */}
      <div
        className="absolute inset-x-2 bottom-1.5 top-auto h-2.5 opacity-50"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to right, var(--muted-foreground) 0 1px, transparent 1px 10%)",
        }}
      />
      {/* target marker ▼ */}
      <div
        className="absolute top-0 -translate-x-1/2"
        style={{ left: `${target}%` }}
      >
        <div
          className={cn(
            "mx-auto size-0 border-x-[6px] border-t-8 border-x-transparent",
            solved ? "border-t-emerald-500" : "border-t-primary",
          )}
        />
        <div
          className={cn(
            "mx-auto h-7 w-px",
            solved ? "bg-emerald-500/50" : "bg-primary/40",
          )}
        />
      </div>
      {/* needle */}
      <div
        className={cn(
          "absolute inset-y-1.5 w-[3px] -translate-x-1/2 rounded-full shadow-sm",
          solved ? "bg-emerald-500" : "bg-foreground/80",
          !drag && "transition-[left] duration-200 ease-out",
        )}
        style={{ left: `${shown}%` }}
      >
        <span
          className={cn(
            "absolute -bottom-0.5 left-1/2 size-3 -translate-x-1/2 rounded-full border bg-background shadow",
          )}
        />
      </div>
    </div>
  );
}

/** Game 2 — hold to fill the bar; let go on the marker. */
function HoldGame({ target, solved, onSolve }: GameProps) {
  const tel = useTelemetry();
  const [pos, setPos] = useState(0);
  const [holding, setHolding] = useState(false);
  const [miss, setMiss] = useState(false);
  const raf = useRef(0);
  const posRef = useRef(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    setHolding(false);
  }, []);

  function release() {
    if (solved) return;
    stop();
    const p = posRef.current;
    if (Math.abs(p - target) <= TOLERANCE) onSolve(tel.result(p));
    else {
      setMiss(true);
      setTimeout(() => {
        setMiss(false);
        posRef.current = 0;
        setPos(0);
      }, 300);
    }
  }

  function hold() {
    if (solved || holding) return;
    tel.begin();
    setHolding(true);
    let last = performance.now();
    const SPEED = 42; // %/second — calm, controllable
    const tick = (now: number) => {
      tel.move();
      posRef.current = Math.min(100, posRef.current + ((now - last) / 1000) * SPEED);
      last = now;
      setPos(posRef.current);
      if (posRef.current >= 100) {
        // Overshot the end — treat as a miss and reset gently.
        release();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const shown = solved ? target : pos;
  return (
    <div
      role="slider"
      aria-label="Hold to fill the bar; let go on the marker"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown)}
      tabIndex={solved ? -1 : 0}
      className={cn(LANE, !solved && "cursor-pointer", miss && "hc-shake")}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        hold();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!holding) hold();
        }
      }}
      onKeyUp={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          release();
        }
      }}
    >
      {/* fill */}
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-r-sm",
          solved ? "bg-emerald-500/25" : "bg-primary/20",
        )}
        style={{ width: `${shown}%` }}
      />
      {/* leading edge */}
      <div
        className={cn(
          "absolute inset-y-1.5 w-[3px] -translate-x-1/2 rounded-full",
          solved ? "bg-emerald-500" : "bg-primary",
        )}
        style={{ left: `${shown}%` }}
      />
      {/* target marker */}
      <div
        className="absolute top-0 -translate-x-1/2"
        style={{ left: `${target}%` }}
      >
        <div
          className={cn(
            "mx-auto size-0 border-x-[6px] border-t-8 border-x-transparent",
            solved ? "border-t-emerald-500" : "border-t-foreground/60",
          )}
        />
        <div className="mx-auto h-7 w-px bg-foreground/30" />
      </div>
      {solved && (
        <Check className="absolute right-2 top-1/2 size-4 -translate-y-1/2 text-emerald-600" />
      )}
    </div>
  );
}

const GAME_HINTS = [
  "Slide the piece into the dashed slot",
  "Drag the needle to the marker",
  "Press and hold to fill — let go at the marker",
];

/**
 * The sign-in/sign-up human check. Invisible mode: a proof-of-work solves
 * silently behind a one-line status. Game mode: the same proof-of-work plus
 * one of several one-gesture mini-games — the server picks the variant and
 * target and signs them, so there's no single pattern for a bot to learn.
 */
export function HumanCheck({
  onChange,
  nonce = 0,
}: {
  /** Fires with the full payload when ready, or null while pending. */
  onChange: (payload: HumanPayload | null) => void;
  /** Bump to mint a fresh challenge (e.g. after a server-side rejection). */
  nonce?: number;
}) {
  const { config } = useConfig();
  const mode = config.challengeMode;

  const [challenge, setChallenge] = useState<string | null>(null);
  const [solution, setSolution] = useState<string | null>(null);
  const [powState, setPowState] = useState<"solving" | "ready" | "error">("solving");
  const [game, setGame] = useState<GameResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Mint a challenge and start solving the proof-of-work in the background.
  useEffect(() => {
    if (mode === "off") {
      onChange(null);
      return;
    }
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setChallenge(null);
    setSolution(null);
    setGame(null);
    setPowState("solving");
    api
      .get<{ challenge: string | null; difficulty: number }>("/auth/challenge")
      .then(async (r) => {
        if (ctl.signal.aborted) return;
        if (!r.challenge) {
          setPowState("ready"); // difficulty 0 — nothing to solve
          return;
        }
        setChallenge(r.challenge);
        const sol = await solvePow(r.challenge, r.difficulty, ctl.signal);
        if (ctl.signal.aborted) return;
        setSolution(sol);
        setPowState("ready");
      })
      .catch(() => {
        if (!ctl.signal.aborted) setPowState("error");
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, nonce]);

  // Report readiness upward whenever any piece changes.
  useEffect(() => {
    if (mode === "off") return;
    const powDone = powState === "ready";
    const gameDone = mode !== "game" || game !== null;
    if (powDone && gameDone && challenge) {
      onChange({
        challenge,
        solution: solution ?? "",
        ...(game
          ? { gamePos: game.pos, gameDuration: game.duration, gameMoves: game.moves }
          : {}),
      });
    } else {
      onChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, powState, game, challenge, solution]);

  if (mode === "off") return null;

  // --- Invisible mode: just a quiet status line --------------------------------
  if (mode !== "game") {
    return (
      <p
        className={cn(
          "flex items-center justify-center gap-1.5 text-xs",
          powState === "ready" ? "text-emerald-600" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {powState === "ready" ? (
          <>
            <Check className="size-3.5" /> Browser verified
          </>
        ) : powState === "error" ? (
          <>Couldn’t verify — check your connection</>
        ) : (
          <>
            <Loader2 className="size-3.5 animate-spin" /> Checking your browser…
          </>
        )}
      </p>
    );
  }

  // --- Game mode ----------------------------------------------------------------
  const meta = challenge ? challengeMeta(challenge) : null;
  const solved = game !== null;
  const Game = meta ? [SlideGame, DialGame, HoldGame][meta.m % 3] : null;

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border bg-card p-3 shadow-xs transition-colors",
        solved && "border-emerald-500/50",
      )}
    >
      {!meta || !Game ? (
        <div className="flex h-11 items-center justify-center rounded-lg bg-muted/50">
          {powState === "error" ? (
            <span className="text-xs text-muted-foreground">
              Couldn’t load the check — refresh to retry
            </span>
          ) : (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>
      ) : (
        <Game target={meta.g} solved={solved} onSolve={setGame} />
      )}

      <div className="flex items-center justify-between gap-2 text-xs" aria-live="polite">
        <span className={solved ? "font-medium text-emerald-600" : "text-muted-foreground"}>
          {solved ? "Verified — you're human" : meta ? GAME_HINTS[meta.m % 3] : "Loading…"}
        </span>
        {solved && powState !== "ready" && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> finishing up…
          </span>
        )}
      </div>
    </div>
  );
}
