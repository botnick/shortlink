/**
 * Challenge + verification-token storage.
 *
 * Lives in the relational DB (Postgres/D1), NOT in KV: single-use semantics
 * need atomic claims, and Workers KV is eventually consistent. Two primitives
 * carry all the security weight here:
 *
 *  - claimChallengeStep: optimistic-concurrency UPDATE guarded by `version`.
 *    Parallel submits race on one row; exactly one wins. This is also what
 *    makes step-skipping impossible — the row IS the state machine.
 *
 *  - consumeVerification: single UPDATE … WHERE consumed_at IS NULL RETURNING.
 *    One statement, atomic in both dialects; a token can be redeemed once,
 *    ever, no matter how many requests arrive at the same instant.
 *
 * Only HASHES of the opaque secrets are stored. Expired rows are purged by the
 * existing daily cron.
 */
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { DB, DbSchema } from "../../db";
import type { GameInstance } from "./games";

export type ChallengeStatus = "active" | "done" | "locked";

export interface ChallengeRecord {
  id: string;
  action: string;
  hostname: string;
  clientKey: string;
  mode: string;
  status: ChallengeStatus;
  version: number;
  gameIndex: number;
  gamesTotal: number;
  retries: number;
  powDifficulty: number;
  powDone: boolean;
  riskScore: number;
  game: GameInstance | null;
  playedTypes: string[];
  issuedAt: Date;
  expiresAt: Date;
}

interface NewChallenge {
  refHash: string;
  action: string;
  hostname: string;
  clientKey: string;
  mode: string;
  gamesTotal: number;
  powDifficulty: number;
  game: GameInstance | null;
  playedTypes: string[];
  expiresAt: Date;
}

export async function insertChallenge(
  db: DB,
  schema: DbSchema,
  data: NewChallenge,
): Promise<string> {
  const { humanChallenges } = schema;
  const rows = await db
    .insert(humanChallenges)
    .values({
      refHash: data.refHash,
      action: data.action,
      hostname: data.hostname,
      clientKey: data.clientKey,
      mode: data.mode,
      gamesTotal: data.gamesTotal,
      powDifficulty: data.powDifficulty,
      game: data.game as Record<string, unknown> | null,
      playedTypes: data.playedTypes,
      expiresAt: data.expiresAt,
    })
    .returning({ id: humanChallenges.id });
  return rows[0].id;
}

export async function findChallengeByRefHash(
  db: DB,
  schema: DbSchema,
  refHash: string,
): Promise<ChallengeRecord | null> {
  const { humanChallenges } = schema;
  const rows = await db
    .select()
    .from(humanChallenges)
    .where(eq(humanChallenges.refHash, refHash))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    action: r.action,
    hostname: r.hostname,
    clientKey: r.clientKey,
    mode: r.mode,
    status: r.status as ChallengeStatus,
    version: r.version,
    gameIndex: r.gameIndex,
    gamesTotal: r.gamesTotal,
    retries: r.retries,
    powDifficulty: r.powDifficulty,
    powDone: r.powDone,
    riskScore: r.riskScore,
    game: (r.game as GameInstance | null) ?? null,
    playedTypes: (r.playedTypes as string[] | null) ?? [],
    issuedAt: r.issuedAt,
    expiresAt: r.expiresAt,
  };
}

interface StepUpdate {
  status?: ChallengeStatus;
  gameIndex?: number;
  gamesTotal?: number;
  retries?: number;
  powDone?: boolean;
  riskScore?: number;
  game?: GameInstance | null;
  playedTypes?: string[];
}

/**
 * Atomically advance the challenge state machine. Succeeds only if the row is
 * still `active` AND nobody else advanced it first (version match) — the
 * loser of a parallel-submit race gets `false` and a generic error.
 */
export async function claimChallengeStep(
  db: DB,
  schema: DbSchema,
  id: string,
  expectedVersion: number,
  set: StepUpdate,
): Promise<boolean> {
  const { humanChallenges } = schema;
  const rows = await db
    .update(humanChallenges)
    .set({
      ...set,
      game: (set.game === undefined
        ? undefined
        : (set.game as Record<string, unknown> | null)),
      version: sql`${humanChallenges.version} + 1`,
    })
    .where(
      and(
        eq(humanChallenges.id, id),
        eq(humanChallenges.version, expectedVersion),
        eq(humanChallenges.status, "active"),
      ),
    )
    .returning({ id: humanChallenges.id });
  return rows.length === 1;
}

interface NewVerification {
  tokenHash: string;
  challengeId: string;
  action: string;
  hostname: string;
  clientKey: string;
  expiresAt: Date;
}

export async function insertVerification(
  db: DB,
  schema: DbSchema,
  data: NewVerification,
): Promise<void> {
  const { humanVerifications } = schema;
  await db.insert(humanVerifications).values(data);
}

interface ConsumedVerification {
  challengeId: string;
  action: string;
  hostname: string;
  clientKey: string;
  expiresAt: Date;
}

/**
 * Redeem a verification token exactly once. The row is claimed atomically even
 * when the bindings later turn out wrong — a token presented with the wrong
 * action/host/session is burned, not left around for a second try.
 */
export async function consumeVerification(
  db: DB,
  schema: DbSchema,
  tokenHash: string,
): Promise<ConsumedVerification | null> {
  const { humanVerifications } = schema;
  const rows = await db
    .update(humanVerifications)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(humanVerifications.tokenHash, tokenHash),
        isNull(humanVerifications.consumedAt),
      ),
    )
    .returning({
      challengeId: humanVerifications.challengeId,
      action: humanVerifications.action,
      hostname: humanVerifications.hostname,
      clientKey: humanVerifications.clientKey,
      expiresAt: humanVerifications.expiresAt,
    });
  return rows[0] ?? null;
}

/** Cron hygiene: drop rows an hour past expiry (TTL substitute for SQL). */
export async function purgeHumanRecords(db: DB, schema: DbSchema): Promise<void> {
  const cutoff = new Date(Date.now() - 3_600_000);
  await db
    .delete(schema.humanChallenges)
    .where(lt(schema.humanChallenges.expiresAt, cutoff));
  await db
    .delete(schema.humanVerifications)
    .where(lt(schema.humanVerifications.expiresAt, cutoff));
}
