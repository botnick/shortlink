import type { CaptchaGameDTO } from "@shared/captcha";
import type { EvidenceRecorder } from "@/lib/captcha";

export interface GameProps {
  game: CaptchaGameDTO;
  rec: EvidenceRecorder;
  disabled: boolean;
  /** Submit the answer for server-side validation (the client never knows
   *  whether it is correct — it only knows the gesture finished). */
  onAnswer: (answer: unknown) => void;
  /** The admin tolerance profile (geometry-forgiveness multiplier) the game
   *  applies to its acceptance gate, so the gate mirrors the server's and a
   *  lenient setting feels lenient on the client too. The server holds the
   *  authoritative tolerance and re-validates. Games without an alignment gate
   *  (tap-match, sort) simply ignore it. */
  tolerance: number;
}
