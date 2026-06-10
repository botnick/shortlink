/**
 * Integration smoke for the full human-check chain, end to end, through the
 * REAL Worker app + REAL database: mint → solve the game from the PUBLIC
 * payload only → solve the proof-of-work → verify → receive a one-time token,
 * then prove the challenge is single-use (replaying the winning submit fails).
 *
 * Safe to run against the dev DB: it only inserts into human_challenges /
 * human_verifications and deletes exactly the rows it created. It never touches
 * users, links or settings (it reads whatever mode the admin has configured).
 *
 * Run: node --env-file=.dev.vars node_modules/tsx/dist/cli.mjs tests/captcha-flow.ts
 *
 * The solver below classifies each piece by COUNTING POLYGON VERTICES — i.e. it
 * plays the role of a sighted user (or a CV bot). That it must do this, rather
 * than read `obj.shape`, is the whole point of shipping nameless geometry.
 */
import postgres from "postgres";
import app from "../worker/index";
import { sha256Hex } from "../worker/lib/captcha/crypto";

const DB_URL =
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??
  process.env.DBURL;
if (!DB_URL) {
  console.error("No DB url in env — run with: node --env-file=.dev.vars …");
  process.exit(1);
}

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
};

const kv = new Map<string, string>();
const env = {
  HYPERDRIVE: { connectionString: DB_URL },
  LINKS_KV: {
    async get(k: string, t?: string) {
      const v = kv.get(k);
      return v === undefined ? null : t === "json" ? JSON.parse(v) : v;
    },
    async put(k: string, v: string) {
      kv.set(k, v);
    },
    async delete(k: string) {
      kv.delete(k);
    },
  },
  ASSETS: { async fetch() { return new Response("<!doctype html>"); } },
  APP_URL: "https://localhost",
  SESSION_SECRET: "flow-test-secret-0123456789abcdef",
  SETUP_TOKEN: "x",
};

const ctx = { waitUntil() {}, passThroughOnException() {} };
async function post(path: string, body: unknown) {
  const res = await app.fetch(
    new Request(`https://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://localhost", "cf-connecting-ip": "198.51.100.42" },
      body: JSON.stringify(body),
    }),
    env as never,
    ctx as never,
  );
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

// --- geometry helpers (public-payload-only solver) ---------------------------

interface Obj { id: string; poly?: { x: number; y: number }[]; round?: boolean; pos: { x: number; y: number }; size: number; label?: string }

/** Classify a piece's shape from its outline — the CV a sighted user does. */
function shapeOf(o: Obj): string {
  if (o.round || !o.poly) return "circle";
  const n = o.poly.length;
  if (n === 3) return "triangle";
  if (n === 6) return "hexagon";
  if (n === 10) return "star";
  if (n === 12) return "plus";
  if (n >= 14) return "heart";
  if (n === 4) {
    // square (corners off-axis) vs diamond (corners on-axis)
    const onAxis = o.poly.some(
      (v) => Math.abs(v.x) < 0.35 || Math.abs(v.y) < 0.35,
    );
    return onAxis ? "diamond" : "square";
  }
  return "unknown";
}

function promptShape(prompt: string): string {
  for (const s of ["triangle", "hexagon", "star", "heart", "diamond", "square", "circle", "plus"]) {
    if (prompt.toLowerCase().includes(s)) return s;
  }
  return "";
}

type Ev = { t: string; x?: number; y?: number; targetId?: string; offsetMs: number };

/** Curved, variable-speed, jittered drag — passes the risk engine. */
function drag(a: { x: number; y: number }, b: { x: number; y: number }, t0: number): { events: Ev[]; end: number } {
  const events: Ev[] = [{ t: "pointer-down", x: a.x, y: a.y, offsetMs: t0 }];
  const cx = (a.x + b.x) / 2 + 12, cy = (a.y + b.y) / 2 - 9;
  let t = t0;
  for (let i = 1; i <= 20; i++) {
    const u = i / 20;
    const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    const x = (1 - e) ** 2 * a.x + 2 * (1 - e) * e * cx + e * e * b.x + Math.sin(i) * 0.6;
    const y = (1 - e) ** 2 * a.y + 2 * (1 - e) * e * cy + e * e * b.y + Math.cos(i) * 0.6;
    t += 17 + (i % 3) * 8;
    events.push({ t: "pointer-move", x, y, offsetMs: t });
  }
  events.push({ t: "pointer-up", x: b.x, y: b.y, offsetMs: t + 25 });
  return { events, end: t + 25 };
}

/** Build {answer, evidence} for any game from the public payload only. */
function solve(game: { type: string; prompt: string; payload: Record<string, unknown> }): { answer: unknown; evidence: unknown } {
  const mk = (events: Ev[], inputMode = "mouse") => ({
    startedAtOffsetMs: events.length ? events[0].offsetMs : 0,
    completedAtOffsetMs: events.length ? events[events.length - 1].offsetMs : 0,
    viewport: { w: 390, h: 780, dpr: 2 },
    inputMode,
    events,
  });
  const p = game.payload;
  switch (game.type) {
    case "tap-match": {
      const objs = p.objects as Obj[];
      const want = promptShape(game.prompt);
      const obj = objs.find((o) => shapeOf(o) === want) ?? objs[0];
      return { answer: { objectId: obj.id }, evidence: mk([{ t: "pointer-down", x: obj.pos.x, y: obj.pos.y, offsetMs: 700 }, { t: "pointer-up", x: obj.pos.x, y: obj.pos.y, offsetMs: 800 }], "touch") };
    }
    case "drag-target": {
      const objs = p.objects as Obj[];
      const ring = p.ring as { pos: { x: number; y: number } };
      const want = promptShape(game.prompt);
      const obj = objs.find((o) => shapeOf(o) === want) ?? objs[0];
      return { answer: { objectId: obj.id }, evidence: mk(drag(obj.pos, ring.pos, 220).events) };
    }
    case "path-trace": {
      const dots = (p.dots as Obj[]).slice().sort((a, b) => Number(a.label) - Number(b.label));
      const events: Ev[] = [{ t: "pointer-down", x: dots[0].pos.x, y: dots[0].pos.y, offsetMs: 220 }];
      let t = 220;
      for (let k = 1; k < dots.length; k++) {
        const a = dots[k - 1].pos, b = dots[k].pos;
        for (let i = 1; i <= 8; i++) { const u = i / 8; t += 22 + (i % 2) * 7; events.push({ t: "pointer-move", x: a.x + (b.x - a.x) * u + Math.sin(i) * 0.5, y: a.y + (b.y - a.y) * u, offsetMs: t }); }
      }
      events.push({ t: "pointer-up", x: dots[dots.length - 1].pos.x, y: dots[dots.length - 1].pos.y, offsetMs: t + 25 });
      return { answer: { order: dots.map((d) => d.id) }, evidence: mk(events) };
    }
    case "connect": {
      const objs = p.objects as Obj[];
      const want = promptShape(game.prompt);
      const pair = objs.filter((o) => shapeOf(o) === want).slice(0, 2);
      const [a, b] = pair.length === 2 ? pair : objs.slice(0, 2);
      return { answer: { a: a.id, b: b.id }, evidence: mk(drag(a.pos, b.pos, 220).events) };
    }
    case "sort-3": {
      const objs = (p.objects as Obj[]).slice().sort((a, b) => a.size - b.size);
      const events: Ev[] = [];
      let t = 400;
      for (const o of objs) { events.push({ t: "pointer-down", x: o.pos.x, y: o.pos.y, offsetMs: t }); t += 500; }
      return { answer: { order: objs.map((o) => o.id) }, evidence: mk(events, "touch") };
    }
    case "rotate": {
      const dot = p.dot as { angle: number };
      const events: Ev[] = [{ t: "pointer-down", x: 70, y: 52, offsetMs: 220 }];
      let t = 220;
      for (let i = 1; i <= 12; i++) { t += 24 + (i % 2) * 6; events.push({ t: "pointer-move", x: 70 - i, y: 52 + i * 0.7, offsetMs: t }); }
      events.push({ t: "pointer-up", x: 55, y: 60, offsetMs: t + 20 });
      return { answer: { angle: dot.angle }, evidence: mk(events) };
    }
    default:
      return { answer: {}, evidence: mk([]) };
  }
}

// --- proof-of-work (mirrors the browser solver) ------------------------------

function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const b of bytes) { if (b === 0) { bits += 8; continue; } let x = b; while ((x & 0x80) === 0) { bits++; x <<= 1; } break; }
  return bits;
}
async function solvePow(ref: string, bits: number): Promise<string> {
  if (bits <= 0) return "";
  const enc = new TextEncoder();
  for (let i = 0; ; i++) {
    const sol = i.toString(36);
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${ref}.${sol}`)));
    if (leadingZeroBits(d) >= bits) return sol;
  }
}

/** Temporarily force a game mode (so the GAME solve path is exercised), keeping
 *  the admin's real values to restore afterwards. Direct settings writes only. */
async function forceGameMode(): Promise<{ mode: unknown; pow: unknown; risk: unknown }> {
  const sql = postgres(DB_URL!, { max: 1, prepare: false, fetch_types: false });
  try {
    const prior = await sql`select key, value from settings where key in ('challenge_mode','pow_difficulty','captcha_risk_high')`;
    const get = (k: string) => prior.find((r) => r.key === k)?.value;
    const before = { mode: get("challenge_mode"), pow: get("pow_difficulty"), risk: get("captcha_risk_high") };
    // Lower PoW to keep it fast; game-only guarantees an upfront game; raise the
    // risk-block ceiling so the synthesized (necessarily fast, machine-uniform)
    // drag doesn't trip the behavioral engine — this test exercises the
    // mint→solve→verify→token chain, NOT risk blocking (that has its own tests).
    await sql`insert into settings (key, value) values ('challenge_mode', '"game-only"'::jsonb) on conflict (key) do update set value = excluded.value`;
    await sql`insert into settings (key, value) values ('pow_difficulty', '8'::jsonb) on conflict (key) do update set value = excluded.value`;
    await sql`insert into settings (key, value) values ('captcha_risk_high', '100'::jsonb) on conflict (key) do update set value = excluded.value`;
    return before;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

let restore: { mode: unknown; pow: unknown; risk: unknown } | null = null;

async function main() {
  console.log("\n[captcha flow] mint → solve → verify → token (real app + DB)");
  const createdRefHashes: string[] = [];
  const createdTokenHashes: string[] = [];
  restore = await forceGameMode();

  const mint = await post("/api/captcha/challenge", { action: "login" });
  check("challenge minted (200)", mint.status === 200, mint.status);
  if (mint.status !== 200 || !mint.json) {
    if (mint.status === 409) console.log("    (human check is disabled in this DB — enable a game mode to exercise the flow)");
    return finish(createdRefHashes, createdTokenHashes);
  }
  const ref = mint.json.ref as string;
  createdRefHashes.push(await sha256Hex(ref));

  type Game = { id: string; type: string; prompt: string; payload: Record<string, unknown> };
  let game = mint.json.game as Game | null;
  const pow = mint.json.pow as { difficulty: number } | null;
  const mode = game ? "game" : "invisible (no upfront game)";
  check("public payload carries NO shape name", !JSON.stringify(mint.json).includes('"shape"'));
  console.log(`    mode: ${mode}; pow: ${pow ? pow.difficulty + " bits" : "off"}`);

  const powSolution = pow ? await solvePow(ref, pow.difficulty) : undefined;
  check("proof-of-work solved", pow === null || (powSolution !== undefined && powSolution.length > 0));

  // First submit: pow-only when invisible (no upfront game), else the solved
  // game. Then follow the server's lead through any games/retries to a token.
  let token: string | null = null;
  let first = true;
  for (let step = 0; step < 5; step++) {
    const body: Record<string, unknown> = { ref, powSolution };
    if (game) {
      const { answer, evidence } = solve(game);
      body.gameId = game.id;
      body.answer = answer;
      body.evidence = evidence;
    } else if (!first) {
      break; // no game and not the first call — nothing to submit
    }
    first = false;
    const res = await post("/api/captcha/verify", body);
    if (res.status !== 200 || !res.json) {
      check(`verify step ${step} (200)`, false, { status: res.status, body: res.json });
      return finish(createdRefHashes, createdTokenHashes);
    }
    if (res.json.status === "ok") {
      token = res.json.token as string;
      break;
    }
    check(`verify step ${step}: ${res.json.status} → next game`, res.json.status === "next" || res.json.status === "retry", res.json.status);
    game = res.json.game as Game;
  }

  check("verification token issued", !!token && /^hv1_[0-9a-f]{64}$/.test(token), token);
  if (token) createdTokenHashes.push(await sha256Hex(token));

  // --- Deception layer (fail-closed) ---------------------------------------
  // A fake bypass endpoint must answer realistically but NEVER hand out a real
  // token (decoy prefix only).
  const fake = await post("/api/captcha/dev/solve", { anything: true });
  const fakeTok = fake.json?.token as string | undefined;
  check("fake endpoint responds 200", fake.status === 200, fake.status);
  check("fake endpoint token is a decoy (never hv1_)", !!fakeTok && !fakeTok.startsWith("hv1_") && fakeTok.startsWith("ag_decoy_"), fakeTok);

  // A canary field on /verify must not pass; it gets a decoy token, not a real one.
  const canary = await post("/api/captcha/verify", { ref, bypass: true, gameId: "x", answer: {}, evidence: { startedAtOffsetMs: 0, completedAtOffsetMs: 10, viewport: { w: 1, h: 1, dpr: 1 }, inputMode: "mouse", events: [] } });
  const canaryTok = canary.json?.token as string | undefined;
  check("canary verify returns a decoy token, never hv1_", !canaryTok || !canaryTok.startsWith("hv1_"), canaryTok);

  // Honey Game: a tripped CHALLENGE request returns a stateless honey ref
  // (hcH_, never a DB row); solving it via /verify never mints a real token.
  const honeyMint = await post("/api/captcha/challenge", { action: "login", bypassEligible: true });
  const honeyRef = honeyMint.json?.ref as string | undefined;
  check("tripped challenge returns a honey ref (hcH_, not hc1_)", !!honeyRef && honeyRef.startsWith("hcH_"), honeyRef);
  if (honeyRef) {
    const honeyVerify = await post("/api/captcha/verify", { ref: honeyRef, powSolution: "x", gameId: (honeyMint.json?.game as { id?: string })?.id ?? "g", answer: {}, evidence: { startedAtOffsetMs: 0, completedAtOffsetMs: 1000, viewport: { w: 1, h: 1, dpr: 1 }, inputMode: "mouse", events: [] } });
    const honeyTok = honeyVerify.json?.token as string | undefined;
    check("honey verify never mints a real hv1_ token", !honeyTok || !honeyTok.startsWith("hv1_"), honeyTok);
  }

  // Single-use challenge: replaying the winning submit must now fail (the
  // challenge is 'done', not 'active').
  const replay = await post("/api/captcha/verify", { ref, powSolution, gameId: game?.id ?? "x", answer: {}, evidence: { startedAtOffsetMs: 0, completedAtOffsetMs: 1000, viewport: { w: 1, h: 1, dpr: 1 }, inputMode: "mouse", events: [] } });
  check("replay of completed challenge rejected (403)", replay.status === 403, replay.status);

  return finish(createdRefHashes, createdTokenHashes);
}

async function finish(refHashes: string[], tokenHashes: string[]) {
  // Tidy up our own rows AND restore the admin's real settings.
  const sql = postgres(DB_URL!, { max: 1, prepare: false, fetch_types: false });
  try {
    for (const h of refHashes) await sql`delete from human_challenges where ref_hash = ${h}`;
    for (const h of tokenHashes) await sql`delete from human_verifications where token_hash = ${h}`;
    if (restore) {
      const put = async (k: string, v: unknown) => {
        if (v === undefined) {
          await sql`delete from settings where key = ${k}`;
        } else {
          await sql`insert into settings (key, value) values (${k}, ${sql.json(v as object)}) on conflict (key) do update set value = excluded.value`;
        }
      };
      await put("challenge_mode", restore.mode);
      await put("pow_difficulty", restore.pow);
      await put("captcha_risk_high", restore.risk);
    }
  } catch (e) {
    console.error("cleanup warning:", e);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
