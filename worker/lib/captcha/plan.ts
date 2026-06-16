/**
 * Challenge planning — how many games, how hard, per verification mode.
 *
 * The plan is decided ON THE SERVER at challenge creation and stored in the
 * challenge row; the client cannot change the mode, skip games, or shrink the
 * count. Risk NEVER skips a game: in every game mode the floor is one game
 * ("forced game" guarantee — no silent pass); risk only tunes difficulty and,
 * at the high tier, the count.
 */
import type { GameDifficulty, VerificationMode } from "@shared/captcha";

interface ChallengePlan {
  gamesTotal: number;
  difficulty: GameDifficulty;
}

export function planChallenge(
  mode: VerificationMode,
  cfg: { minGames: number },
): ChallengePlan {
  switch (mode) {
    case "invisible":
      // Background check first; escalation to ONE EASY game (never a hard one
      // out of nowhere) is decided at verify time when confidence is low.
      return { gamesTotal: 0, difficulty: "easy" };
    case "game-only":
      // Everyone plays the configured number of EASY games (default 1). Easy =
      // fewer decoys, the gentlest layout (human-first). Risk tunes retries and
      // difficulty-on-retry, never the count, so there's no surprise escalation.
      return { gamesTotal: Math.min(3, Math.max(1, cfg.minGames)), difficulty: "easy" };
    default:
      // "disabled" — callers bail out before ever planning a challenge.
      return { gamesTotal: 0, difficulty: "easy" };
  }
}
