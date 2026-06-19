import {
  Check,
  ChevronDown,
  ChevronRight,
  Link2,
  Loader2,
  Lock,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { SLUG_OPTIONS } from "@/lib/linkForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BackLink } from "@/components/BackLink";
import { AliasRow } from "@/components/link-editor/AliasRow";
import { useLinkEditorForm } from "./link-editor/useLinkEditorForm";
import { AdvancedSections } from "./link-editor/AdvancedSections";
import { PreviewRail } from "./link-editor/PreviewRail";

/** Full-page link create/edit in Rebrandly's clean, progressive-disclosure style:
 *  a focused form (destination → short link → collapsible advanced sections) with
 *  a sticky preview rail (short link + QR). State + effects live in
 *  useLinkEditorForm; the advanced sections and preview rail are their own
 *  components — this file is the layout shell + the core (destination + short
 *  link) fields. */
export function LinkEditor() {
  const f = useLinkEditorForm();
  const {
    isEdit,
    navigate,
    shortHost,
    selected,
    loaded,
    link,
    destination,
    onDestinationChange,
    normalizeDestination,
    destValid,
    domains,
    selectedHost,
    domainId,
    setDomainId,
    alias,
    setAlias,
    setSlugStrategy,
    hasSlugSource,
    shortLen,
    longLen,
    optimizeSlug,
    aiAssist,
    aiLoading,
    slugStatus,
    slugStrategy,
    aliases,
    tags,
    setTags,
    tagInput,
    setTagInput,
    addTag,
    commitPendingTag,
    passwordOn,
    setPasswordOn,
    password,
    setPassword,
    isActive,
    setIsActive,
    submitting,
    handleSubmit,
  } = f;

  if (!loaded) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  const actions = (
    <>
      <Button type="button" variant="outline" onClick={() => navigate("/dashboard")}>
        Cancel
      </Button>
      <Button
        type="submit"
        disabled={submitting || !destValid || slugStatus === "taken" || slugStatus === "reserved"}
      >
        {submitting && <Loader2 className="animate-spin" />}
        {isEdit ? "Save changes" : "Create link"}
      </Button>
    </>
  );

  return (
    <form onSubmit={handleSubmit}>
      <header className="mb-6">
        <BackLink to="/dashboard" />
        <div className="mt-3 flex items-start gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {isEdit ? "Edit branded link" : "Create a branded link & QR"}
            </h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
              {isEdit
                ? "Update where it points and how it’s shared."
                : "One link with campaign tracking, device routing and a social card."}
            </p>
          </div>
          <div className="hidden items-center gap-2 lg:flex">{actions}</div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        {/* ---- Core form (destination + short link) ---- */}
        <div className="space-y-4 lg:col-start-1 lg:row-start-1">
          {/* Destination (hero) */}
          <section className="space-y-3 rounded-2xl border bg-card p-5">
            <Label htmlFor="destination" className="text-sm font-medium">
              Destination URL
            </Label>
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="destination"
                type="url"
                inputMode="url"
                autoFocus={!isEdit}
                placeholder="Type or paste a link (https://…)"
                value={destination}
                onChange={(e) => onDestinationChange(e.target.value)}
                onBlur={normalizeDestination}
                className="h-11 pl-9 pr-9 text-base"
              />
              {destValid && (
                <Check className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-emerald-600" />
              )}
            </div>
            {destination.trim() && !destValid ? (
              <p className="text-xs text-amber-600">
                Enter a valid link, e.g. example.com — we’ll add https:// for you.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Where the short link sends people by default.
              </p>
            )}
          </section>

          {/* Short link */}
          <section className="space-y-4 rounded-2xl border bg-card p-5">
            <div className="space-y-2">
              <Label htmlFor="alias">
                {isEdit ? (
                  "Back-half"
                ) : (
                  <>
                    Custom back-half{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </>
                )}
              </Label>
              <div className="flex items-stretch gap-2">
                <div className="flex h-9 min-w-0 flex-1 items-center overflow-hidden rounded-md border border-input bg-transparent text-sm focus-within:ring-2 focus-within:ring-ring">
                  {domains.length > 0 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex max-w-[45%] shrink-0 items-center gap-1 whitespace-nowrap rounded-l-md py-2 pl-3 text-muted-foreground hover:text-foreground"
                          title="Choose a domain"
                        >
                          <span className="truncate">{selectedHost}</span>
                          <ChevronDown className="size-3 shrink-0 opacity-60" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="max-w-[16rem]">
                        <DropdownMenuItem onClick={() => setDomainId(null)}>
                          <span className="flex-1 truncate">{shortHost}</span>
                          <span className="ml-2 text-xs text-muted-foreground">default</span>
                          {domainId === null && <Check className="ml-1 size-3.5" />}
                        </DropdownMenuItem>
                        {domains.map((d) => (
                          <DropdownMenuItem key={d.id} onClick={() => setDomainId(d.id)}>
                            <span className="flex-1 truncate">{d.hostname}</span>
                            {domainId === d.id && <Check className="ml-1 size-3.5" />}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="shrink-0 whitespace-nowrap pl-3 text-muted-foreground">
                      {shortHost}
                    </span>
                  )}
                  <span className="px-0.5 text-muted-foreground">/</span>
                  <input
                    id="alias"
                    className="h-full w-full min-w-0 bg-transparent px-1 text-base outline-none md:text-sm"
                    placeholder="my-link"
                    value={alias}
                    onChange={(e) => {
                      setAlias(e.target.value);
                      setSlugStrategy("");
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  onClick={() => void aiAssist()}
                  disabled={aiLoading || !hasSlugSource}
                  title="Suggest a slug + social card from the destination page"
                >
                  {aiLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Wand2 className="size-4" />
                  )}
                  AI
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="shrink-0 gap-1.5">
                      <Sparkles className="size-4" /> Optimize
                      <ChevronDown className="size-3.5 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    {SLUG_OPTIONS.map((o) => {
                      const disabled = o.needsSource && !hasSlugSource;
                      const desc =
                        o.kind === "shortest"
                          ? `Shortest random — ${shortLen} characters`
                          : o.kind === "random"
                            ? `Longer random — ${longLen} characters`
                            : o.desc;
                      return (
                        <DropdownMenuItem
                          key={o.kind}
                          disabled={disabled}
                          onClick={() => optimizeSlug(o.kind)}
                          className="flex-col items-start gap-0.5"
                        >
                          <span className="text-sm font-medium">{o.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {disabled ? "Enter a destination first" : desc}
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {alias.trim() && !/^[a-zA-Z0-9_-]{3,32}$/.test(alias.trim()) ? (
                <p className="text-[11px] text-amber-600">
                  3–32 characters: letters, numbers, - or _
                </p>
              ) : slugStatus === "checking" ? (
                <p className="text-[11px] text-muted-foreground">Checking availability…</p>
              ) : slugStatus === "taken" ? (
                <p className="text-[11px] text-red-600">That back-half is taken — try another.</p>
              ) : slugStatus === "reserved" ? (
                <p className="text-[11px] text-red-600">That back-half is reserved.</p>
              ) : slugStatus === "available" ? (
                <p className="flex items-center gap-1 text-[11px] text-emerald-600">
                  <Check className="size-3" /> Available
                </p>
              ) : slugStrategy ? (
                <p className="text-[11px] text-muted-foreground">{slugStrategy} back-half</p>
              ) : null}
              {isEdit && (
                <p className="text-[11px] text-muted-foreground">
                  Changing the back-half or domain keeps the old short link working — it
                  still redirects here.
                </p>
              )}
              {isEdit && aliases.length > 0 && (
                <details className="group pt-0.5">
                  <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                    <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                    {aliases.length} previous back-half{aliases.length > 1 ? "es" : ""} ·
                    still redirect here
                  </summary>
                  <ul className="mt-1 divide-y rounded-md border">
                    {aliases.map((a) => (
                      <AliasRow key={a.id} alias={a} />
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {!isEdit && selected && (
              <p className="text-[11px] text-muted-foreground">
                Saving to{" "}
                <span className="font-medium text-foreground/70">{selected.name}</span> —
                switch projects on the dashboard.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="tags">
                Tags <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
                  >
                    {t}
                    <button
                      type="button"
                      aria-label={`Remove ${t}`}
                      onClick={() => setTags(tags.filter((x) => x !== t))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <input
                  id="tags"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                      e.preventDefault();
                      addTag(tagInput);
                    } else if (e.key === "Backspace" && !tagInput && tags.length) {
                      setTags(tags.slice(0, -1));
                    }
                  }}
                  onBlur={commitPendingTag}
                  placeholder={tags.length ? "" : "marketing, q1-campaign…"}
                  className="min-w-[8ch] flex-1 bg-transparent outline-none"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Press Enter or comma to add. Up to 20.
              </p>
            </div>

            <div className="space-y-2">
              <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3">
                <span className="flex items-center gap-2.5">
                  <Lock className="size-4 text-muted-foreground" />
                  <span>
                    <span className="block text-sm font-medium">Password protect</span>
                    <span className="block text-xs text-muted-foreground">
                      Visitors enter a password to open the link.
                    </span>
                  </span>
                </span>
                <Switch checked={passwordOn} onCheckedChange={setPasswordOn} />
              </label>
              {passwordOn && (
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    isEdit && link?.hasPassword
                      ? "Leave blank to keep the current password"
                      : "Set a password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </div>

            {isEdit && (
              <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3">
                <span>
                  <span className="block text-sm font-medium">Active</span>
                  <span className="block text-xs text-muted-foreground">
                    Inactive links stop redirecting.
                  </span>
                </span>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </label>
            )}
          </section>
        </div>

        {/* ---- Advanced (UTM / device / social) — below the rail on mobile ---- */}
        <AdvancedSections form={f} />

        {/* ---- Preview rail ---- */}
        <PreviewRail form={f} />
      </div>

      {/* Sticky action bar (mobile) */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-5 flex items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        {actions}
      </div>
    </form>
  );
}
