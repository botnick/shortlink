import type { CaptchaGameDTO } from "@shared/captcha";
import type { EvidenceRecorder } from "@/lib/captcha";

export interface GameProps {
  game: CaptchaGameDTO;
  rec: EvidenceRecorder;
  disabled: boolean;
  /** Submit the answer for server-side validation (the client never knows
   *  whether it is correct — it only knows the gesture finished). */
  onAnswer: (answer: unknown) => void;
  /** Multiplier the game applies to its own "feels aligned" acceptance gate:
   *  the admin tolerance profile, widened a little on coarse (touch) pointers.
   *  UX only — the server holds the real tolerance and re-validates. Games
   *  without an alignment gate (tap-match, sort) simply ignore it. */
  tolerance: number;
}
