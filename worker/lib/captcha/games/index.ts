/**
 * The game pool. Adding a game = implement GamePlugin, register it here, add a
 * client renderer, and it shows up in the admin "Enabled games" list — the
 * engine, storage and risk layers are game-agnostic.
 */
import type { GameDifficulty, GameType } from "@shared/captcha";
import { pick, sceneId } from "../rng";
import type { GamePlugin, GeneratedGame } from "./types";
import { dragTarget } from "./dragTarget";
import { slide } from "./slide";
import { tapMatch } from "./tapMatch";
import { rotate } from "./rotate";
import { connect } from "./connect";
import { sortThree } from "./sortThree";
import { pathTrace } from "./pathTrace";
import { keyCount } from "./keyCount";

export const GAME_PLUGINS: Record<GameType, GamePlugin> = {
  slide,
  "drag-target": dragTarget,
  "tap-match": tapMatch,
  rotate,
  connect,
  "sort-3": sortThree,
  "path-trace": pathTrace,
  "key-count": keyCount,
};

export interface GameInstance extends GeneratedGame {
  /** Per-instance id the client must echo back — guards step sequencing. */
  id: string;
  difficulty: GameDifficulty;
  /** Server clock when this slot was issued — feeds the too-fast risk signal. */
  issuedAtMs: number;
}

/**
 * Single-action games (one tap / one keypress) carry almost no behavioral
 * signal — a scripted clean solve scores ~0 because there's no drag stream or
 * tap cadence to inspect. They're fine as a warm-up in a multi-game plan, but
 * must NEVER be the LAST game before a token is minted, or a script could mint
 * on a single one. `finalPool` strips them so the final/solo game always carries
 * enough interaction (a real drag, a 3-tap sort, an ordered trace) to score.
 * Falls back to a strong default if an admin somehow enabled only weak games.
 */
const WEAK_FINAL_GAMES: readonly GameType[] = ["tap-match", "key-count"];

export function finalPool(enabled: GameType[]): GameType[] {
  const strong = enabled.filter((t) => !WEAK_FINAL_GAMES.includes(t));
  return strong.length > 0 ? strong : ["sort-3", "drag-target"];
}

/**
 * Generate a fresh game instance. `exclude` avoids repeating a type within one
 * challenge (and across retries), so no single automation pattern gets a
 * second look at the same kind of puzzle.
 */
export function generateGame(
  enabled: GameType[],
  difficulty: GameDifficulty,
  exclude: string[] = [],
): GameInstance {
  const pool = enabled.filter((t) => !exclude.includes(t));
  const type = pick(pool.length > 0 ? pool : enabled);
  const game = GAME_PLUGINS[type].generate({ difficulty });
  return { ...game, id: sceneId(), difficulty, issuedAtMs: Date.now() };
}
