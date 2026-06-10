import type {
  CaptchaEvent,
  CaptchaInputMode,
  GameDifficulty,
  GamePublicPayload,
  GameType,
} from "@shared/captcha";

export interface GameGenContext {
  difficulty: GameDifficulty;
}

export interface GeneratedGame {
  type: GameType;
  prompt: string;
  /** Sent to the client verbatim — must never identify the correct answer
   *  beyond what a human needs to see to play. */
  payload: GamePublicPayload;
  /** Server-only ground truth. Stored in the challenge row, never serialized
   *  into any response. */
  secret: Record<string, unknown>;
}

export interface GameValidateInput {
  payload: GamePublicPayload;
  secret: Record<string, unknown>;
  answer: unknown;
  events: CaptchaEvent[];
  inputMode: CaptchaInputMode;
  /** Geometry tolerance multiplier (admin setting: lenient/standard/strict).
   *  Tolerances are deliberately generous — a human fumbling slightly must
   *  pass; the *answer* (which object, which order) is the discriminator. */
  tolerance: number;
}

export interface GamePlugin {
  type: GameType;
  generate(ctx: GameGenContext): GeneratedGame;
  /** Pure check: does the answer match the secret state AND is it supported
   *  by the recorded interaction? Behavioral plausibility (speed, linearity,
   *  cadence) is scored separately by the risk engine. */
  validate(input: GameValidateInput): boolean;
}
