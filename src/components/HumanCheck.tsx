import "@fontsource/press-start-2p/400.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Keyboard, Loader2, Shuffle } from "lucide-react";
import type {
  CaptchaAction,
  CaptchaChallengeDTO,
  CaptchaGameDTO,
} from "@shared/captcha";
import { ApiError } from "@/lib/api";
import { EvidenceRecorder, mintChallenge, submitVerify } from "@/lib/captcha";
import { solvePow } from "@/lib/pow";
import { useConfig } from "@/lib/config";
import { cn } from "@/lib/utils";
import { GAME_VIEWS } from "./captcha/games";
import { CaptchaPaletteContext, ThemeBackground, paletteForGame } from "./captcha/themes";

/** Everything the sign-in/sign-up form needs: the one-time token. */
export interface HumanPayload {
  humanToken: string;
}

type Phase = "loading" | "playing" | "submitting" | "done" | "error";

/**
 * The human check (v3). Turnstile-style lifecycle: mint a challenge, solve the
 * proof-of-work silently, play the server-chosen game(s), submit interaction
 * evidence, and receive a one-time verification token for the form to send.
 *
 * This component holds NO secrets and makes NO trust decisions — if every line
 * of it is reverse-engineered or hooked, the attacker has learned how to render
 * shapes. Pass/fail lives on the server.
 */
export function HumanCheck({
  action,
  onChange,
  nonce = 0,
}: {
  /** Which protected action this check is for — bound into the token. */
  action: CaptchaAction;
  /** Fires with the token when verified, or null while pending. */
  onChange: (payload: HumanPayload | null) => void;
  /** Bump to force a fresh challenge (e.g. after a server-side rejection). */
  nonce?: number;
}) {
  const { config } = useConfig();
  const mode = config.challengeMode;

  const [phase, setPhase] = useState<Phase>("loading");
  const [game, setGame] = useState<CaptchaGameDTO | null>(null);
  const [progress, setProgress] = useState({ total: 0, index: 0 });
  const [hint, setHint] = useState<string | null>(null);

  const chRef = useRef<CaptchaChallengeDTO | null>(null);
  const recRef = useRef<EvidenceRecorder | null>(null);
  const powRef = useRef<Promise<string | undefined>>(Promise.resolve(undefined));
  const abortRef = useRef<AbortController | null>(null);
  const remintsRef = useRef(0);
  const phaseRef = useRef<Phase>("loading");
  phaseRef.current = phase;
  // Phase H — once a user opts into the keyboard-only check, stay on it.
  const accessibleRef = useRef(false);
  // A fresh decorative pixel-art backdrop per challenge (purely cosmetic).
  const [themeSeed, setThemeSeed] = useState(() => Math.floor(Math.random() * 1e9));
  // Coarse pointer (finger) → widen the client "feels aligned" gates a little on
  // top of the admin tolerance, so an imprecise touch isn't rejected before the
  // server even sees it. Stable for the component's life.
  const [coarsePointer] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches,
  );

  const mint = useCallback(async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setPhase("loading");
    setGame(null);
    setHint(null);
    setThemeSeed((s) => s + 1 + Math.floor(Math.random() * 5)); // fresh backdrop
    onChange(null);
    try {
      const ch = await mintChallenge(action, accessibleRef.current);
      if (ctl.signal.aborted) return;
      chRef.current = ch;
      recRef.current = new EvidenceRecorder(ch.limits.maxEvents);
      // The proof-of-work burns CPU in the background while the user plays —
      // humans never notice it; scripted farms pay for every attempt.
      powRef.current = ch.pow
        ? solvePow(ch.ref, ch.pow.difficulty, ctl.signal).catch(
            (): string | undefined => undefined,
          )
        : Promise.resolve(undefined);

      if (ch.game) {
        setGame(ch.game);
        setProgress({ total: ch.gamesTotal, index: ch.gameIndex });
        setPhase("playing");
      } else {
        // Invisible mode: hand in the background work AND the passive automation
        // probe (webdriver / headless / automation globals / synthetic events).
        // The server scores it and either issues a token or escalates to one
        // easy game — a genuine browser passes silently.
        setPhase("submitting");
        const powSolution = await powRef.current;
        if (ctl.signal.aborted) return;
        await verify({ powSolution, evidence: recRef.current?.evidence() }, ctl);
      }
    } catch {
      if (!ctl.signal.aborted) setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  async function verify(
    extra: {
      powSolution?: string;
      gameId?: string;
      answer?: unknown;
      evidence?: ReturnType<EvidenceRecorder["evidence"]>;
    },
    ctl: AbortController,
  ) {
    const ch = chRef.current;
    if (!ch) return;
    try {
      const res = await submitVerify({ ref: ch.ref, ...extra });
      if (ctl.signal.aborted) return;
      if (res.status === "ok") {
        setGame(null);
        setPhase("done");
        onChange({ humanToken: res.token });
        return;
      }
      // next game in the sequence, or a fresh layout after a miss
      recRef.current = new EvidenceRecorder(ch.limits.maxEvents);
      setGame(res.game);
      setProgress({ total: res.gamesTotal, index: res.gameIndex });
      setHint(res.status === "retry" ? "Not quite — fresh puzzle, try again" : null);
      setPhase("playing");
    } catch (err) {
      if (ctl.signal.aborted) return;
      if (err instanceof ApiError && err.status === 429) {
        setHint("Too many attempts — please wait a moment");
        setPhase("error");
      } else if (remintsRef.current < 2) {
        // Challenge expired/used/raced — quietly start over with a fresh one.
        remintsRef.current += 1;
        void mint();
      } else {
        setHint(null);
        setPhase("error");
      }
    }
  }

  // Mint on mount and whenever the parent bumps the nonce.
  useEffect(() => {
    if (mode === "disabled") {
      onChange(null);
      return;
    }
    remintsRef.current = 0;
    void mint();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, nonce, mint]);

  // Re-mint shortly before the challenge expires (unless already verified).
  useEffect(() => {
    const ch = chRef.current;
    if (!ch || phase === "done" || phase === "error") return;
    const ms = ch.expiresAt - Date.now() - 1500;
    const t = setTimeout(() => {
      if (phaseRef.current !== "done") void mint();
    }, Math.max(1000, ms));
    return () => clearTimeout(t);
  }, [game, phase, mint]);

  if (mode === "disabled") return null;

  const handleAnswer = async (answer: unknown) => {
    const ctl = abortRef.current;
    const g = game;
    const rec = recRef.current;
    if (!ctl || !g || !rec || phase !== "playing") return;
    setPhase("submitting");
    const powSolution = await powRef.current;
    if (ctl.signal.aborted) return;
    await verify(
      { powSolution, gameId: g.id, answer, evidence: rec.evidence() },
      ctl,
    );
  };

  const View = game ? GAME_VIEWS[game.type] : null;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3 shadow-xs transition-colors",
        phase === "done" && "border-emerald-500/50",
      )}
    >
      {phase === "done" ? (
        <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-600" aria-live="polite">
          <Check className="hc-pop size-3.5" /> Verified — you're human
        </p>
      ) : phase === "error" ? (
        <div className="flex items-center justify-between gap-2 text-xs" aria-live="polite">
          <span className="text-muted-foreground">
            {hint ?? "Couldn't verify — check your connection"}
          </span>
          <button
            type="button"
            className="font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => {
              remintsRef.current = 0;
              void mint();
            }}
          >
            Try again
          </button>
        </div>
      ) : !game || !View || !recRef.current ? (
        <p
          className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
          aria-live="polite"
        >
          <Loader2 className="size-3.5 animate-spin" />
          {phase === "submitting" ? "Checking your browser…" : "Loading check…"}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium" aria-live="polite">
              {game.prompt}
            </p>
            {progress.total > 1 && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {Math.min(progress.index + 1, progress.total)}/{progress.total}
              </span>
            )}
          </div>
          <div className="relative mx-auto aspect-[100/66] w-full max-w-[300px] overflow-hidden rounded-lg border bg-[#0a0e1c]">
            <ThemeBackground seed={themeSeed} gameType={game.type} />
            {/* The game is wrapped in a positioned layer so it paints ABOVE the
                absolutely-positioned backdrop (positioned siblings stack by DOM
                order; a static child would be painted under the backdrop). */}
            <div className="absolute inset-0">
              <CaptchaPaletteContext.Provider value={paletteForGame(game.type, themeSeed)}>
                <View
                  key={game.id}
                  game={game}
                  rec={recRef.current}
                  disabled={phase !== "playing"}
                  onAnswer={handleAnswer}
                  tolerance={
                    (chRef.current?.tolerance ?? 1) * (coarsePointer ? 1.25 : 1)
                  }
                />
              </CaptchaPaletteContext.Provider>
            </div>
            {phase === "submitting" && (
              <div className="absolute inset-0 grid place-items-center bg-background/50">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span aria-live="polite">{hint ?? " "}</span>
            <div className="flex shrink-0 items-center gap-1.5">
              {!accessibleRef.current && (
                <button
                  type="button"
                  aria-label="Switch to a keyboard-only challenge"
                  className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
                  onClick={() => {
                    accessibleRef.current = true;
                    remintsRef.current = 0;
                    void mint();
                  }}
                >
                  <Keyboard className="size-3" /> Keyboard
                </button>
              )}
              <button
                type="button"
                aria-label="Get a different puzzle"
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
                onClick={() => {
                  remintsRef.current = 0;
                  void mint();
                }}
              >
                <Shuffle className="size-3" /> {accessibleRef.current ? "New" : "New puzzle"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
