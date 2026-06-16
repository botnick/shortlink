/**
 * Phase H — accessible, keyboard-only challenge. The server picks a short
 * directional sequence (e.g. ↑ → ↓ →); the client reveals one arrow at a time
 * and advances on each correct key, auto-submitting on the last one — no Enter,
 * no pointer, no reaction time, no colour. Everything needed is operable from
 * the keyboard and announced for a screen reader.
 *
 * It is validated SERVER-SIDE like every other game: the recorded key-downs
 * must match the secret sequence in order and show human timing. As with the
 * visual games, the sequence is necessarily known to the client that renders
 * it — the moat is proof-of-work per attempt, single-use challenge, rate limits
 * and plausible-timing, not answer secrecy.
 */
import type { ArrowDirection, KeyCountPayload } from "@shared/captcha";
import { pick, randInt } from "../rng";
import { asRecord } from "./helpers";
import type { GamePlugin, GameValidateInput } from "./types";

type Secret = {
  sequence: ArrowDirection[];
};

const DIRS: readonly ArrowDirection[] = ["left", "right", "up", "down"];
// Sequence length per difficulty.
const LEN = { easy: [3, 4], normal: [4, 5], hard: [5, 6] } as const;

/** Recorder targetId for a directional key press (see client KeyCountGame). */
const keyId = (dir: string) => `key-${dir}`;

export const keyCount: GamePlugin = {
  type: "key-count",

  generate({ difficulty }) {
    const [lo, hi] = LEN[difficulty];
    const n = randInt(lo, hi);
    const sequence = Array.from({ length: n }, () => pick(DIRS as ArrowDirection[]));
    const payload: KeyCountPayload = { game: "key-count", sequence };
    const secret: Secret = { sequence };
    return {
      type: "key-count",
      prompt: `Press each arrow key as it appears — ${n} in a row`,
      payload,
      secret,
    };
  },

  validate({ secret, answer, events }: GameValidateInput) {
    const s = (secret as unknown as Secret).sequence;
    const a = asRecord(answer);
    if (!a || a.pressed !== s.length) return false;

    // The directional key-downs, in the order they were pressed. (The client
    // tags each press with `key-<direction>` and only records a press that
    // matched the arrow then on screen.)
    const presses = events
      .filter(
        (e) =>
          e.t === "key-down" &&
          typeof e.targetId === "string" &&
          e.targetId.startsWith("key-"),
      )
      .sort((x, y) => x.offsetMs - y.offsetMs);
    if (presses.length !== s.length) return false;
    for (let i = 0; i < s.length; i++) {
      if (presses[i].targetId !== keyId(s[i])) return false;
    }

    // Human timing: the presses must span real time, not a single instantaneous
    // burst. A person needs ~tens of ms between keystrokes.
    if (s.length >= 2) {
      const span = presses[presses.length - 1].offsetMs - presses[0].offsetMs;
      if (span < (s.length - 1) * 40) return false; // faster than humanly possible
    }
    return true;
  },
};
