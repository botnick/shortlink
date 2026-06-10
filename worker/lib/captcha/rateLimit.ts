/**
 * Rate-limit front door for the human check. Rate limiting is now unified in
 * `isRateLimited` (DO-first, KV fallback, fail-open), so this is a thin alias
 * kept for call-site readability in the captcha code.
 */
import type { AppBindings } from "../../env";
import { isRateLimited } from "../ratelimit";

/** TRUE when the caller is OVER the limit (see isRateLimited). */
export function rateLimited(
  env: AppBindings,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  return isRateLimited(env, bucket, limit, windowSec);
}
