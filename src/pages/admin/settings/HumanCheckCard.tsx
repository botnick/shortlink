import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import {
  POOL_GAME_TYPES,
  type GameType,
  type VerificationMode,
} from "@shared/captcha";
import type { SettingsDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { SettingsCard } from "./SettingsCard";
import type { SettingsPatch } from "./useSettingsData";

const GAME_LABELS: Record<(typeof POOL_GAME_TYPES)[number], string> = {
  slide: "Slide to notch",
  "drag-target": "Drag to target",
  "tap-match": "Tap the shape",
  rotate: "Rotate the arrow",
  connect: "Connect the pair",
  "sort-3": "Sort by size",
  "path-trace": "Trace the path",
};

export function HumanCheckCard({
  settings,
  loading,
  patch,
}: {
  settings: SettingsDTO | null;
  loading: boolean;
  patch: SettingsPatch;
}) {
  return (
    <SettingsCard
      title="Human check (sign-in & sign-up)"
      description={
        <>
          Interactive game CAPTCHA backed by proof-of-work. All decisions are
          made server-side; tokens are one-time and bound to the action.
        </>
      }
      loading={loading}
    >
      {settings && <HumanCheckForm initial={settings} patch={patch} />}
    </SettingsCard>
  );
}

function HumanCheckForm({ initial, patch }: { initial: SettingsDTO; patch: SettingsPatch }) {
  const [powDifficulty, setPowDifficulty] = useState(initial.powDifficulty ?? 16);
  const [challengeMode, setChallengeMode] = useState<VerificationMode>(initial.challengeMode ?? "game-only");
  const [captchaGames, setCaptchaGames] = useState<GameType[]>(
    initial.captchaGames?.length ? initial.captchaGames : [...POOL_GAME_TYPES],
  );
  const [captchaMinGames, setCaptchaMinGames] = useState(initial.captchaMinGames ?? 1);
  // No UI input — round-tripped from settings (clamped at save), so it's a const.
  const captchaMaxGames = initial.captchaMaxGames ?? 2;
  const [captchaChallengeTtl, setCaptchaChallengeTtl] = useState(initial.captchaChallengeTtl ?? 120);
  const [captchaTokenTtl, setCaptchaTokenTtl] = useState(initial.captchaTokenTtl ?? 300);
  const [captchaMaxRetries, setCaptchaMaxRetries] = useState(initial.captchaMaxRetries ?? 3);
  const [captchaMaxEvents, setCaptchaMaxEvents] = useState(initial.captchaMaxEvents ?? 300);
  const [captchaRiskMedium, setCaptchaRiskMedium] = useState(initial.captchaRiskMedium ?? 30);
  const [captchaRiskHigh, setCaptchaRiskHigh] = useState(initial.captchaRiskHigh ?? 60);
  const [captchaTolerance, setCaptchaTolerance] = useState<"lenient" | "standard" | "strict">(
    initial.captchaTolerance ?? "standard",
  );
  const [captchaCreateLimit, setCaptchaCreateLimit] = useState(initial.captchaCreateLimit ?? 10);
  const [captchaVerifyLimit, setCaptchaVerifyLimit] = useState(initial.captchaVerifyLimit ?? 30);
  const [captchaEnforce, setCaptchaEnforce] = useState(initial.captchaEnforce ?? true);
  const [saving, setSaving] = useState(false);
  const [captchaStats, setCaptchaStats] = useState<Record<string, unknown> | null>(null);

  // Human-check live activity (best-effort; reads existing rows, no writes).
  useEffect(() => {
    api
      .get<Record<string, unknown>>("/admin/captcha-stats")
      .then(setCaptchaStats)
      .catch(() => {});
  }, []);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      const minG = Math.min(3, Math.max(1, Math.floor(captchaMinGames) || 1));
      await patch({
        challengeMode,
        powDifficulty: Math.min(26, Math.max(0, Math.floor(powDifficulty) || 0)),
        captchaGames: captchaGames.length ? captchaGames : [...POOL_GAME_TYPES],
        captchaMinGames: minG,
        captchaMaxGames: Math.min(3, Math.max(minG, Math.floor(captchaMaxGames) || minG)),
        captchaChallengeTtl: Math.min(600, Math.max(30, Math.floor(captchaChallengeTtl) || 120)),
        captchaTokenTtl: Math.min(900, Math.max(60, Math.floor(captchaTokenTtl) || 300)),
        captchaMaxRetries: Math.min(10, Math.max(1, Math.floor(captchaMaxRetries) || 3)),
        captchaMaxEvents: Math.min(1000, Math.max(50, Math.floor(captchaMaxEvents) || 300)),
        captchaRiskMedium: Math.min(100, Math.max(1, Math.floor(captchaRiskMedium) || 30)),
        captchaRiskHigh: Math.min(100, Math.max(1, Math.floor(captchaRiskHigh) || 60)),
        captchaTolerance,
        captchaCreateLimit: Math.max(0, Math.floor(captchaCreateLimit) || 0),
        captchaVerifyLimit: Math.max(0, Math.floor(captchaVerifyLimit) || 0),
        captchaEnforce,
      });
      toast.success("Human check saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
        <div>
          <p className="text-sm font-medium">Enforce risk blocking</p>
          <p className="text-xs text-muted-foreground">
            Off = shadow mode: high-risk attempts are logged but still pass.
            Watch the activity below, then turn on. The game is always required.
          </p>
        </div>
        <Switch
          checked={captchaEnforce}
          onCheckedChange={setCaptchaEnforce}
          aria-label="Enforce risk blocking"
        />
      </div>

      {captchaStats && (
        <div className="rounded-lg border bg-background p-3 text-xs">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-medium">Live activity</span>
            <span className="text-muted-foreground">{String(captchaStats.window)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[
              ["total", "Total"],
              ["done", "Passed"],
              ["locked", "Locked"],
              ["wouldBlockAtThreshold", "≥ block risk"],
              ["avgRisk", "Avg risk"],
              ["maxRisk", "Max risk"],
            ].map(([k, label]) => (
              <div key={k} className="rounded-md bg-muted/40 p-2 text-center">
                <div className="text-base font-semibold tabular-nums">
                  {String((captchaStats[k] as number | string) ?? 0)}
                </div>
                <div className="text-[10px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            {captchaStats.enforcing
              ? "Enforcing: attempts at/above block risk are rejected."
              : "Shadow mode: nothing is blocked — “≥ block risk” is what enforcing WOULD reject."}
          </p>
          {captchaStats.deception ? (
            <div className="mt-2 border-t pt-2">
              <div className="mb-1 text-[10px] font-medium text-muted-foreground">
                Deception traps (decoys / fake bypass / forged tokens)
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
                {Object.entries(captchaStats.deception as Record<string, number>).map(
                  ([k, v]) => (
                    <span key={k} className="tabular-nums">
                      <span className="text-muted-foreground">{k}:</span>{" "}
                      <span className="font-semibold">{v}</span>
                    </span>
                  ),
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="hcMode">Mode</Label>
        <select
          id="hcMode"
          value={challengeMode}
          onChange={(e) => setChallengeMode(e.target.value as VerificationMode)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="game-only">Game — everyone plays (no silent pass)</option>
          <option value="invisible">
            Invisible — silent check; an easy game only when unsure
          </option>
          <option value="disabled">Disabled</option>
        </select>
        <p className="text-[11px] text-muted-foreground">
          In Game mode there is no silent pass — risk can make a retry
          harder, never skip the game.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Enabled games</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {POOL_GAME_TYPES.map((g) => {
            const checked = captchaGames.includes(g);
            return (
              <label
                key={g}
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) =>
                    setCaptchaGames((prev) =>
                      v
                        ? [...prev, g]
                        : prev.length > 1
                          ? prev.filter((x) => x !== g)
                          : prev,
                    )
                  }
                />
                {GAME_LABELS[g]}
              </label>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Each challenge picks randomly from this pool (at least one stays on);
          retries always rotate to a different game.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="powBits">Proof-of-work difficulty (bits)</Label>
          <Input
            id="powBits"
            type="number"
            min={0}
            max={26}
            value={powDifficulty}
            onChange={(e) => setPowDifficulty(Number(e.target.value))}
          />
          <p className="text-[11px] text-muted-foreground">
            Silent CPU cost per attempt, solved in a Web Worker (~tens of ms
            at 16). Each +1 doubles it; failures escalate it automatically.
            14–18 recommended; 0 turns the layer off.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hcTolerance">Touch tolerance</Label>
          <select
            id="hcTolerance"
            value={captchaTolerance}
            onChange={(e) =>
              setCaptchaTolerance(e.target.value as "lenient" | "standard" | "strict")
            }
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="lenient">Lenient — most forgiving</option>
            <option value="standard">Standard</option>
            <option value="strict">Strict</option>
          </select>
          <p className="text-[11px] text-muted-foreground">
            How forgiving the geometry is for shaky hands. Lenient minimizes
            false rejections.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hcChTtl">Challenge lifetime (seconds)</Label>
          <Input
            id="hcChTtl"
            type="number"
            min={30}
            max={600}
            value={captchaChallengeTtl}
            onChange={(e) => setCaptchaChallengeTtl(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hcTokTtl">Token lifetime (seconds)</Label>
          <Input
            id="hcTokTtl"
            type="number"
            min={60}
            max={900}
            value={captchaTokenTtl}
            onChange={(e) => setCaptchaTokenTtl(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hcRetries">Retries per game</Label>
          <Input
            id="hcRetries"
            type="number"
            min={1}
            max={10}
            value={captchaMaxRetries}
            onChange={(e) => setCaptchaMaxRetries(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hcEvents">Max interaction events</Label>
          <Input
            id="hcEvents"
            type="number"
            min={50}
            max={1000}
            value={captchaMaxEvents}
            onChange={(e) => setCaptchaMaxEvents(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hcRiskMed">Risk: log from score</Label>
          <Input
            id="hcRiskMed"
            type="number"
            min={1}
            max={100}
            value={captchaRiskMedium}
            onChange={(e) => setCaptchaRiskMedium(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hcRiskHigh">Risk: reject from score</Label>
          <Input
            id="hcRiskHigh"
            type="number"
            min={1}
            max={100}
            value={captchaRiskHigh}
            onChange={(e) => setCaptchaRiskHigh(Number(e.target.value))}
          />
          <p className="text-[11px] text-muted-foreground">
            Signals are weighted so no single one reaches this on its own.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hcMinG">Games per challenge</Label>
          <Input
            id="hcMinG"
            type="number"
            min={1}
            max={3}
            value={captchaMinGames}
            onChange={(e) => setCaptchaMinGames(Number(e.target.value))}
          />
          <p className="text-[11px] text-muted-foreground">
            How many short games everyone plays (1 = one game).
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hcCreate">Challenges / minute / IP</Label>
          <Input
            id="hcCreate"
            type="number"
            min={0}
            value={captchaCreateLimit}
            onChange={(e) => setCaptchaCreateLimit(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hcVerify">Verifies / minute / IP</Label>
          <Input
            id="hcVerify"
            type="number"
            min={0}
            value={captchaVerifyLimit}
            onChange={(e) => setCaptchaVerifyLimit(Number(e.target.value))}
          />
        </div>
      </div>

      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="animate-spin" />}
        Save
      </Button>
    </form>
  );
}
