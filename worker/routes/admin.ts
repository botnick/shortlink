import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  type SQL,
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  sql,
  sum,
} from "drizzle-orm";
import type { AppEnv } from "../env";
import { readDeceptionCounts } from "../lib/captcha/escalation";
import { buildShortUrl, invalidateDomainHost } from "../lib/domainScope";
import { softDeleteUser } from "../lib/accountLifecycle";
import { purgeLinkCache, refreshLinkCache } from "../lib/linkCache";
import { dayBucket, searchCondition } from "../lib/query";
import { hashPassword, pbkdf2Iterations } from "../lib/password";
import { computeGlobalStats, parseRange, rangeStart } from "./stats";
import { toCsv } from "../lib/csv";
import {
  SETTING_KEYS,
  accountHoldDaysFrom,
  apiEnabledFrom,
  apiRateLimitFrom,
  appNameFrom,
  authRateLimitFrom,
  blockedDomainsFrom,
  brandColorFrom,
  captchaChallengeTtlFrom,
  captchaCreateLimitFrom,
  captchaGamesFrom,
  captchaMaxEventsFrom,
  captchaMaxGamesFrom,
  captchaMaxRetriesFrom,
  captchaMinGamesFrom,
  captchaRiskHighFrom,
  captchaRiskMediumFrom,
  captchaToleranceFrom,
  captchaTokenTtlFrom,
  captchaVerifyLimitFrom,
  captchaEnforceFrom,
  challengeModeFrom,
  createRateLimitFrom,
  emailBlockDaysFrom,
  maxAliasesPerLinkFrom,
  maxApiKeysPerUserFrom,
  maxDomainsPerUserFrom,
  mcpEnabledFrom,
  powDifficultyFrom,
  slugLengthFrom,
  cfConfiguredFrom,
  cfFallbackHostFrom,
  cfZoneIdFrom,
  descriptionFrom,
  domainUnverifiedDaysFrom,
  clicksRetentionDaysFrom,
  exportMaxRowsFrom,
  extraReservedFrom,
  getAllSettings,
  indexableFrom,
  logoFrom,
  maxLinksPerUserFrom,
  ogAccentRawFrom,
  ogFontFrom,
  ogImageFrom,
  ogLabelRawFrom,
  ogTaglineRawFrom,
  ogTemplateFrom,
  ogTitleRawFrom,
  brandCopyFrom,
  saasConfigFrom,
  safetyInterstitialFrom,
  twitterHandleFrom,
  setSetting,
} from "../lib/settings";
import { deleteCustomHostname, getCustomHostname } from "../lib/cloudflare";
import { encryptSecret } from "../lib/secret";
import { checkTxtVerification } from "../lib/dns";
import { invalidateSeo } from "../lib/seo";
import { invalidatePublicConfig, shortOrigin } from "../lib/appconfig";
import {
  bulkLinksSchema,
  createUserSchema,
  resetPasswordSchema,
  settingsSchema,
  updateUserRoleSchema,
} from "../lib/validators";
import { requireAdmin } from "../middleware/auth";
import type {
  AdminDomainDTO,
  AdminLinkDTO,
  AdminOverviewDTO,
  AdminUserDTO,
  SettingsDTO,
} from "@shared/types";

const admin = new Hono<AppEnv>();
admin.use("*", requireAdmin);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 25;
const DAY_MS = 86_400_000;

function toSettingsDTO(map: Record<string, unknown>): SettingsDTO {
  return {
    registrationEnabled: map[SETTING_KEYS.registration] === true,
    appName: appNameFrom(map),
    brandColor: brandColorFrom(map),
    logoUrl: logoFrom(map),
    description: descriptionFrom(map),
    ogImageUrl: ogImageFrom(map),
    indexable: indexableFrom(map),
    twitterHandle: twitterHandleFrom(map),
    blockedDomains: blockedDomainsFrom(map),
    extraReserved: extraReservedFrom(map),
    maxLinksPerUser: maxLinksPerUserFrom(map),
    authRateLimit: authRateLimitFrom(map),
    createRateLimit: createRateLimitFrom(map),
    maxDomainsPerUser: maxDomainsPerUserFrom(map),
    maxAliasesPerLink: maxAliasesPerLinkFrom(map),
    apiEnabled: apiEnabledFrom(map),
    apiRateLimit: apiRateLimitFrom(map),
    maxApiKeysPerUser: maxApiKeysPerUserFrom(map),
    mcpEnabled: mcpEnabledFrom(map),
    slugLength: slugLengthFrom(map),
    accountHoldDays: accountHoldDaysFrom(map),
    emailBlockDays: emailBlockDaysFrom(map),
    challengeMode: challengeModeFrom(map),
    powDifficulty: powDifficultyFrom(map),
    captchaGames: captchaGamesFrom(map),
    captchaMinGames: captchaMinGamesFrom(map),
    captchaMaxGames: captchaMaxGamesFrom(map),
    captchaChallengeTtl: captchaChallengeTtlFrom(map),
    captchaTokenTtl: captchaTokenTtlFrom(map),
    captchaMaxRetries: captchaMaxRetriesFrom(map),
    captchaMaxEvents: captchaMaxEventsFrom(map),
    captchaRiskMedium: captchaRiskMediumFrom(map),
    captchaRiskHigh: captchaRiskHighFrom(map),
    captchaTolerance: captchaToleranceFrom(map),
    captchaCreateLimit: captchaCreateLimitFrom(map),
    captchaVerifyLimit: captchaVerifyLimitFrom(map),
    captchaEnforce: captchaEnforceFrom(map),
    cfZoneId: cfZoneIdFrom(map),
    cfFallbackHost: cfFallbackHostFrom(map),
    cfConfigured: cfConfiguredFrom(map),
    domainUnverifiedDays: domainUnverifiedDaysFrom(map),
    clicksRetentionDays: clicksRetentionDaysFrom(map),
    exportMaxRows: exportMaxRowsFrom(map),
    ogTemplate: ogTemplateFrom(map),
    ogFont: ogFontFrom(map),
    ogLabel: ogLabelRawFrom(map),
    ogTitle: ogTitleRawFrom(map),
    ogTagline: ogTaglineRawFrom(map),
    ogAccent: ogAccentRawFrom(map),
    brandCopy: brandCopyFrom(map),
    safetyInterstitial: safetyInterstitialFrom(map),
  };
}

admin.get("/settings", async (c) => {
  const map = await getAllSettings(c.var.db, c.var.schema);
  return c.json(toSettingsDTO(map));
});

// Human-check observability (Phase G). Aggregates over the LIVE challenge rows
// (kept ~minutes before the cron purges them), so it adds NO writes — it just
// reads what's already there. Shows pass/lock rates + the risk-score spread so
// an admin can tune thresholds (and run shadow mode) on real traffic.
admin.get("/captcha-stats", async (c) => {
  const db = c.var.db;
  const { humanChallenges } = c.var.schema;
  const map = await getAllSettings(db, c.var.schema);
  const riskHigh = captchaRiskHighFrom(map);
  const rows = await db
    .select({ status: humanChallenges.status, risk: humanChallenges.riskScore })
    .from(humanChallenges);
  let active = 0, done = 0, locked = 0, wouldBlock = 0, riskSum = 0, riskMax = 0;
  for (const r of rows) {
    if (r.status === "active") active++;
    else if (r.status === "done") done++;
    else if (r.status === "locked") locked++;
    riskSum += r.risk;
    if (r.risk > riskMax) riskMax = r.risk;
    if (r.risk >= riskHigh) wouldBlock++;
  }
  const total = rows.length;
  // Security Deception Monitor — rolling per-kind trap counters.
  const deception = await readDeceptionCounts(c.env);
  return c.json({
    window: "live (unpurged challenges)",
    total,
    active,
    done,
    locked,
    wouldBlockAtThreshold: wouldBlock,
    avgRisk: total ? Math.round(riskSum / total) : 0,
    maxRisk: riskMax,
    riskHigh,
    enforcing: captchaEnforceFrom(map),
    deception,
  });
});

admin.patch("/settings", zValidator("json", settingsSchema), async (c) => {
  const db = c.var.db;
  const schema = c.var.schema;
  const input = c.req.valid("json");
  if (input.registrationEnabled !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.registration, input.registrationEnabled);
  }
  if (input.appName !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.appName, input.appName);
  }
  if (input.brandColor !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.brandColor, input.brandColor);
  }
  if (input.logoUrl !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.logo, input.logoUrl);
  }
  if (input.description !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.description, input.description);
  }
  if (input.ogImageUrl !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.ogImage, input.ogImageUrl);
  }
  if (input.indexable !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.indexable, input.indexable);
  }
  if (input.twitterHandle !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.twitterHandle, input.twitterHandle);
  }
  if (input.blockedDomains !== undefined) {
    const clean = input.blockedDomains
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    await setSetting(db, schema, SETTING_KEYS.blockedDomains, clean);
  }
  if (input.extraReserved !== undefined) {
    const clean = input.extraReserved
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    await setSetting(db, schema, SETTING_KEYS.extraReserved, clean);
  }
  if (input.maxLinksPerUser !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.maxLinksPerUser, input.maxLinksPerUser);
  }
  if (input.authRateLimit !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.authRateLimit, input.authRateLimit);
  }
  if (input.createRateLimit !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.createRateLimit, input.createRateLimit);
  }
  if (input.maxDomainsPerUser !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.maxDomainsPerUser, input.maxDomainsPerUser);
  }
  if (input.maxAliasesPerLink !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.maxAliasesPerLink, input.maxAliasesPerLink);
  }
  if (input.apiEnabled !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.apiEnabled, input.apiEnabled);
  }
  if (input.apiRateLimit !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.apiRateLimit, input.apiRateLimit);
  }
  if (input.maxApiKeysPerUser !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.maxApiKeysPerUser, input.maxApiKeysPerUser);
  }
  if (input.mcpEnabled !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.mcpEnabled, input.mcpEnabled);
  }
  if (input.slugLength !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.slugLength, input.slugLength);
  }
  if (input.accountHoldDays !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.accountHoldDays, input.accountHoldDays);
  }
  if (input.emailBlockDays !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.emailBlockDays, input.emailBlockDays);
  }
  if (input.powDifficulty !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.powDifficulty, input.powDifficulty);
  }
  if (input.challengeMode !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.challengeMode, input.challengeMode);
  }
  if (input.captchaGames !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.captchaGames, input.captchaGames);
  }
  if (input.captchaMinGames !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.captchaMinGames, input.captchaMinGames);
  }
  if (input.captchaMaxGames !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.captchaMaxGames, input.captchaMaxGames);
  }
  if (input.captchaChallengeTtl !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.captchaChallengeTtl, input.captchaChallengeTtl);
  }
  if (input.captchaTokenTtl !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.captchaTokenTtl, input.captchaTokenTtl);
  }
  if (input.captchaMaxRetries !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.captchaMaxRetries, input.captchaMaxRetries);
  }
  if (input.captchaMaxEvents !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.captchaMaxEvents, input.captchaMaxEvents);
  }
  if (input.captchaRiskMedium !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.captchaRiskMedium, input.captchaRiskMedium);
  }
  if (input.captchaRiskHigh !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.captchaRiskHigh, input.captchaRiskHigh);
  }
  if (input.captchaTolerance !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.captchaTolerance, input.captchaTolerance);
  }
  if (input.captchaCreateLimit !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.captchaCreateLimit, input.captchaCreateLimit);
  }
  if (input.captchaVerifyLimit !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.captchaVerifyLimit, input.captchaVerifyLimit);
  }
  if (input.captchaEnforce !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.captchaEnforce, input.captchaEnforce);
  }
  // Custom-domain (Cloudflare for SaaS) config — set via the web, no env vars.
  // An empty token clears it; a blank token is ignored so it isn't wiped on save.
  if (input.cfApiToken !== undefined && input.cfApiToken !== "") {
    // Encrypt at rest so a DB-only leak can't expose the Cloudflare API token
    // (the key derives from SESSION_SECRET, which never touches the database).
    await setSetting(
      db,
      schema,
      SETTING_KEYS.cfApiToken,
      await encryptSecret(input.cfApiToken, c.env.SESSION_SECRET),
    );
  }
  if (input.cfZoneId !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.cfZoneId, input.cfZoneId);
  }
  if (input.cfFallbackHost !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.cfFallbackHost, input.cfFallbackHost);
  }
  if (input.domainUnverifiedDays !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.domainUnverifiedDays, input.domainUnverifiedDays);
  }
  if (input.clicksRetentionDays !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.clicksRetentionDays, input.clicksRetentionDays);
  }
  if (input.exportMaxRows !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.exportMaxRows, input.exportMaxRows);
  }
  if (input.ogTemplate !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.ogTemplate, input.ogTemplate);
  }
  if (input.ogFont !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.ogFont, input.ogFont);
  }
  if (input.ogLabel !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.ogLabel, input.ogLabel);
  }
  if (input.ogTitle !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.ogTitle, input.ogTitle);
  }
  if (input.ogTagline !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.ogTagline, input.ogTagline);
  }
  if (input.ogAccent !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.ogAccent, input.ogAccent);
  }
  if (input.brandCopy !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.brandCopy, input.brandCopy);
  }
  if (input.safetyInterstitial !== undefined) {
    await setSetting(db, schema, SETTING_KEYS.safetyInterstitial, input.safetyInterstitial);
  }
  await invalidateSeo(c.env.LINKS_KV);
  await invalidatePublicConfig(c.env.LINKS_KV);
  const map = await getAllSettings(db, schema);
  return c.json(toSettingsDTO(map));
});

admin.get("/users", async (c) => {
  const db = c.var.db;
  const { users, links } = c.var.schema;
  const q = c.req.query("q") ?? "";
  const cursor = c.req.query("cursor");

  const search = searchCondition([sql`${users.email}`], q);
  const cursorCond =
    cursor && !Number.isNaN(Date.parse(cursor))
      ? lt(users.createdAt, new Date(cursor))
      : undefined;
  // Soft-deleted accounts are held for the purge cron — not shown as members.
  const alive = sql`${users.deletedAt} is null`;
  const where = and(alive, ...([search, cursorCond].filter(Boolean) as SQL[]));

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        isPrimary: users.isPrimary,
        createdAt: users.createdAt,
        linkCount: count(links.id),
      })
      .from(users)
      .leftJoin(links, eq(links.userId, users.id))
      .where(where)
      .groupBy(users.id)
      .orderBy(desc(users.createdAt))
      .limit(PAGE + 1),
    db
      .select({ v: count() })
      .from(users)
      .where(and(alive, ...([search].filter(Boolean) as SQL[])))
      .then((r) => Number(r[0]?.v ?? 0)),
  ]);

  const hasMore = rows.length > PAGE;
  const page = hasMore ? rows.slice(0, PAGE) : rows;
  const body: AdminUserDTO[] = page.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    isPrimary: r.isPrimary,
    createdAt: r.createdAt.toISOString(),
    linkCount: Number(r.linkCount),
  }));
  return c.json({
    users: body,
    nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    total: totalRow,
  });
});

// Promote/demote. The primary admin can never be demoted.
admin.patch("/users/:id", zValidator("json", updateUserRoleSchema), async (c) => {
  const id = c.req.param("id");
  if (!id || !UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);

  const { users } = c.var.schema;
  const { role } = c.req.valid("json");
  const rows = await c.var.db
    .select({ id: users.id, isPrimary: users.isPrimary })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  const target = rows[0];
  if (!target) return c.json({ error: "Not found" }, 404);
  if (target.isPrimary && role !== "admin") {
    return c.json({ error: "The primary admin can't be demoted" }, 403);
  }

  await c.var.db.update(users).set({ role }).where(eq(users.id, id));
  return c.json({ ok: true });
});

// System-wide overview for the admin dashboard.
admin.get("/overview", async (c) => {
  const db = c.var.db;
  const { links, users, clicks } = c.var.schema;
  const since7 = new Date(Date.now() - 7 * DAY_MS);
  const dayExpr = dayBucket(c.var.dialect, sql`${clicks.createdAt}`);

  const [linkAgg, activeAgg, userAgg, clicks7, newLinks7, top, series] =
    await Promise.all([
      db.select({ total: count(), clicks: sum(links.clickCount) }).from(links),
      db
        .select({ v: count() })
        .from(links)
        .where(eq(links.isActive, true))
        .then((r) => Number(r[0]?.v ?? 0)),
      db.select({ v: count() }).from(users).then((r) => Number(r[0]?.v ?? 0)),
      db
        .select({ v: count() })
        .from(clicks)
        .where(gte(clicks.createdAt, since7))
        .then((r) => Number(r[0]?.v ?? 0)),
      db
        .select({ v: count() })
        .from(links)
        .where(gte(links.createdAt, since7))
        .then((r) => Number(r[0]?.v ?? 0)),
      db
        .select({
          id: links.id,
          slug: links.slug,
          clickCount: links.clickCount,
          ownerEmail: users.email,
        })
        .from(links)
        .innerJoin(users, eq(links.userId, users.id))
        .orderBy(desc(links.clickCount))
        .limit(8),
      db
        .select({ day: dayExpr, value: count() })
        .from(clicks)
        .where(gte(clicks.createdAt, since7))
        .groupBy(dayExpr)
        .orderBy(dayExpr),
    ]);

  const body: AdminOverviewDTO = {
    totals: {
      links: Number(linkAgg[0]?.total ?? 0),
      clicks: Number(linkAgg[0]?.clicks ?? 0),
      users: userAgg,
      activeLinks: activeAgg,
    },
    clicks7d: clicks7,
    newLinks7d: newLinks7,
    topLinks: top.map((t) => ({
      id: t.id,
      slug: t.slug,
      clickCount: t.clickCount,
      ownerEmail: t.ownerEmail,
    })),
    timeseries: series.map((r) => ({ day: r.day, count: Number(r.value) })),
    dbDriver: c.var.dialect,
  };
  return c.json(body);
});

// All links across every user — keyset paginated + searchable.
admin.get("/links", async (c) => {
  const db = c.var.db;
  const { links, users, projects, domains } = c.var.schema;
  const q = c.req.query("q") ?? "";
  const cursor = c.req.query("cursor");
  const userId = c.req.query("userId");

  const search = searchCondition(
    [
      sql`${links.slug}`,
      sql`${links.destination}`,
      sql`${users.email}`,
    ],
    q,
  );
  const cursorCond =
    cursor && !Number.isNaN(Date.parse(cursor))
      ? lt(links.createdAt, new Date(cursor))
      : undefined;
  const ownerCond =
    userId && UUID_RE.test(userId) ? eq(links.userId, userId) : undefined;
  const filter = and(
    ...([search, ownerCond].filter(Boolean) as SQL[]),
  );
  const where = and(...([search, cursorCond, ownerCond].filter(Boolean) as SQL[]));

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: links.id,
        slug: links.slug,
        destination: links.destination,
        isActive: links.isActive,
        clickCount: links.clickCount,
        createdAt: links.createdAt,
        ownerEmail: users.email,
        projectName: projects.name,
        domainHost: domains.hostname,
      })
      .from(links)
      .innerJoin(users, eq(links.userId, users.id))
      .leftJoin(projects, eq(links.projectId, projects.id))
      .leftJoin(domains, eq(links.domainId, domains.id))
      .where(where)
      .orderBy(desc(links.createdAt))
      .limit(PAGE + 1),
    db
      .select({ v: count() })
      .from(links)
      .innerJoin(users, eq(links.userId, users.id))
      .where(filter)
      .then((r) => Number(r[0]?.v ?? 0)),
  ]);

  const hasMore = rows.length > PAGE;
  const page = hasMore ? rows.slice(0, PAGE) : rows;
  const base = await shortOrigin(c.env);
  const items: AdminLinkDTO[] = page.map((r) => ({
    id: r.id,
    slug: r.slug,
    shortUrl: buildShortUrl(base, r.domainHost ?? null, r.slug),
    destination: r.destination,
    isActive: r.isActive,
    clickCount: r.clickCount,
    createdAt: r.createdAt.toISOString(),
    ownerEmail: r.ownerEmail,
    projectName: r.projectName ?? null,
    domain: r.domainHost ?? null,
  }));
  return c.json({
    links: items,
    nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    total: totalRow,
  });
});

// Admin can pause/activate any link.
admin.patch(
  "/links/:id",
  zValidator("json", z.object({ isActive: z.boolean() })),
  async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
    const { links } = c.var.schema;
    const { isActive } = c.req.valid("json");
    const rows = await c.var.db
      .update(links)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(links.id, id))
      .returning();
    const row = rows[0];
    if (!row) return c.json({ error: "Not found" }, 404);
    await refreshLinkCache(c.env, c.var.db, c.var.schema, row);
    return c.json({ ok: true });
  },
);

// Admin can delete any link.
admin.delete("/links/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  const { links } = c.var.schema;
  const existing = (
    await c.var.db
      .select({
        slug: links.slug,
        id: links.id,
        domainId: links.domainId,
        ogImage: links.ogImage,
      })
      .from(links)
      .where(eq(links.id, id))
      .limit(1)
  )[0];
  if (!existing) return c.json({ error: "Not found" }, 404);
  // Purge every entry point's cache before the cascade removes the alias rows.
  await purgeLinkCache(c.env, c.var.db, c.var.schema, existing);
  await c.var.db.delete(links).where(eq(links.id, id));
  if (existing.ogImage === "r2") {
    await c.env.LOGO_BUCKET.delete(`og/${existing.id}`).catch(() => {});
  }
  return c.json({ ok: true });
});

// Create a member directly (bypasses the registration toggle).
admin.post("/users", zValidator("json", createUserSchema), async (c) => {
  const db = c.var.db;
  const { users } = c.var.schema;
  const { email, password, role } = c.req.valid("json");

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length > 0) {
    return c.json({ error: "A member with that email already exists" }, 409);
  }
  const passwordHash = await hashPassword(password, c.env.SESSION_SECRET, pbkdf2Iterations(c.env));
  const row = (
    await db
      .insert(users)
      .values({ email, passwordHash, role })
      .returning({
        id: users.id,
        email: users.email,
        role: users.role,
        isPrimary: users.isPrimary,
        createdAt: users.createdAt,
      })
  )[0];
  return c.json(
    { user: { ...row, createdAt: row.createdAt.toISOString(), linkCount: 0 } },
    201,
  );
});

// Reset a member's password and sign them out everywhere.
admin.post(
  "/users/:id/password",
  zValidator("json", resetPasswordSchema),
  async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
    const { users, sessions } = c.var.schema;
    const passwordHash = await hashPassword(c.req.valid("json").password, c.env.SESSION_SECRET, pbkdf2Iterations(c.env));
    const rows = await c.var.db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!rows[0]) return c.json({ error: "Not found" }, 404);
    await c.var.db.delete(sessions).where(eq(sessions.userId, id));
    return c.json({ ok: true });
  },
);

// Bulk pause / activate / delete links.
admin.post("/links/bulk", zValidator("json", bulkLinksSchema), async (c) => {
  const db = c.var.db;
  const { links } = c.var.schema;
  const { ids, action } = c.req.valid("json");

  if (action === "delete") {
    // Read the targets first so alias cache keys can be purged before the
    // cascade removes the alias rows.
    const targets = await db
      .select({
        id: links.id,
        slug: links.slug,
        domainId: links.domainId,
        ogImage: links.ogImage,
      })
      .from(links)
      .where(inArray(links.id, ids));
    // Purge every cache entry point (live back-half + retired aliases) BEFORE the
    // delete. purgeLinkCache reads link_aliases, which the delete cascades away —
    // so running it afterwards (as this did) leaves the retired-alias keys in KV
    // and deleted links keep redirecting via them until the TTL lapses. This
    // mirrors the single-link DELETE and the documented invariant.
    await Promise.all(targets.map((r) => purgeLinkCache(c.env, db, c.var.schema, r)));
    await db.delete(links).where(inArray(links.id, ids));
    c.executionCtx.waitUntil(
      Promise.all(
        targets
          .filter((r) => r.ogImage === "r2")
          .map((r) => c.env.LOGO_BUCKET.delete(`og/${r.id}`).catch(() => {})),
      ).then(() => {}),
    );
    return c.json({ ok: true, count: targets.length });
  }

  const isActive = action === "activate";
  const rows = await db
    .update(links)
    .set({ isActive, updatedAt: new Date() })
    .where(inArray(links.id, ids))
    .returning();
  c.executionCtx.waitUntil(
    Promise.all(
      rows.map((r) => refreshLinkCache(c.env, db, c.var.schema, r)),
    ).then(() => {}),
  );
  return c.json({ ok: true, count: rows.length });
});

// System-wide analytics for the Analytics tab.
admin.get("/analytics", async (c) => {
  const stats = await computeGlobalStats(
    c.var.db,
    c.var.schema,
    c.var.dialect,
    parseRange(c.req.query("range")),
  );
  return c.json(stats);
});

// CSV export of every link (the catalog: one row per link, all-time counts).
admin.get("/export/links.csv", async (c) => {
  const { links, users } = c.var.schema;
  const rows = await c.var.db
    .select({
      slug: links.slug,
      destination: links.destination,
      clicks: links.clickCount,
      active: links.isActive,
      owner: users.email,
      created: links.createdAt,
    })
    .from(links)
    .innerJoin(users, eq(links.userId, users.id))
    .orderBy(desc(links.createdAt));

  const csv = toCsv(
    ["slug", "destination", "clicks", "active", "owner", "created"],
    rows.map((r) => [
      r.slug,
      r.destination,
      r.clicks,
      r.active,
      r.owner,
      r.created.toISOString(),
    ]),
  );
  return c.body(csv, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": 'attachment; filename="links.csv"',
    "cache-control": "no-store",
  });
});

// CSV export of raw clicks across EVERY link (newest first), scoped to the range
// and capped by the admin `exportMaxRows` setting to stay within the CPU budget.
admin.get("/export/clicks.csv", async (c) => {
  const cap = exportMaxRowsFrom(await getAllSettings(c.var.db, c.var.schema));
  if (cap <= 0) return c.json({ error: "Export is disabled" }, 403);

  const { clicks, links } = c.var.schema;
  const range = parseRange(c.req.query("range"));
  const start = rangeStart(range);
  const rows = await c.var.db
    .select({
      at: clicks.createdAt,
      slug: links.slug,
      country: clicks.country,
      referrer: clicks.referrer,
      device: clicks.deviceType,
      os: clicks.os,
      browser: clicks.browser,
      bot: clicks.isBot,
    })
    .from(clicks)
    .innerJoin(links, eq(clicks.linkId, links.id))
    .where(start ? gte(clicks.createdAt, start) : undefined)
    .orderBy(desc(clicks.createdAt))
    .limit(cap);

  const csv = toCsv(
    ["time", "slug", "country", "referrer", "device", "os", "browser", "bot"],
    rows.map((r) => [
      r.at.toISOString(),
      r.slug,
      r.country,
      r.referrer,
      r.device,
      r.os,
      r.browser,
      r.bot ? "1" : "0",
    ]),
  );
  return c.body(csv, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="clicks-${range}.csv"`,
    "cache-control": "no-store",
  });
});

// All custom domains across every user — searchable + paginated.
admin.get("/domains", async (c) => {
  const db = c.var.db;
  const { domains, users } = c.var.schema;
  const q = c.req.query("q") ?? "";
  const cursor = c.req.query("cursor");

  const search = searchCondition(
    [sql`${domains.hostname}`, sql`${users.email}`],
    q,
  );
  const cursorCond =
    cursor && !Number.isNaN(Date.parse(cursor))
      ? lt(domains.createdAt, new Date(cursor))
      : undefined;
  const where = and(...([search, cursorCond].filter(Boolean) as SQL[]));

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: domains.id,
        hostname: domains.hostname,
        status: domains.status,
        verifiedAt: domains.verifiedAt,
        createdAt: domains.createdAt,
        ownerEmail: users.email,
      })
      .from(domains)
      .innerJoin(users, eq(domains.userId, users.id))
      .where(where)
      .orderBy(desc(domains.createdAt))
      .limit(PAGE + 1),
    db
      .select({ v: count() })
      .from(domains)
      .innerJoin(users, eq(domains.userId, users.id))
      .where(search)
      .then((r) => Number(r[0]?.v ?? 0)),
  ]);

  const hasMore = rows.length > PAGE;
  const page = hasMore ? rows.slice(0, PAGE) : rows;
  const items: AdminDomainDTO[] = page.map((r) => ({
    id: r.id,
    hostname: r.hostname,
    status: r.status,
    ownerEmail: r.ownerEmail,
    verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
  return c.json({
    domains: items,
    nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    total: totalRow,
  });
});

// Admin can re-check any domain's verification (Cloudflare hostname or DNS-TXT).
admin.post("/domains/:id/check", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  const { domains } = c.var.schema;
  const rows = await c.var.db.select().from(domains).where(eq(domains.id, id)).limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: "Not found" }, 404);

  const map = await getAllSettings(c.var.db, c.var.schema);
  const saas = await saasConfigFrom(map, c.env.APP_URL, c.env.SESSION_SECRET);

  if (saas && row.cfHostnameId) {
    try {
      const cf = await getCustomHostname(saas, row.cfHostnameId);
      await c.var.db
        .update(domains)
        .set({ status: cf.status, cfRecords: cf.records })
        .where(eq(domains.id, id));
      return c.json({ status: cf.status });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  }

  if (row.status === "verified" || row.status === "active") {
    return c.json({ status: row.status });
  }
  const ok = await checkTxtVerification(row.hostname, row.verifyToken);
  if (!ok) {
    return c.json({ error: "TXT record not found yet — DNS can take a few minutes" }, 400);
  }
  await c.var.db
    .update(domains)
    .set({ status: "verified", verifiedAt: new Date() })
    .where(eq(domains.id, id));
  return c.json({ status: "verified" });
});

// Admin can remove any custom domain.
admin.delete("/domains/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  const { domains } = c.var.schema;
  const existing = (
    await c.var.db
      .select({ hostname: domains.hostname, cfHostnameId: domains.cfHostnameId })
      .from(domains)
      .where(eq(domains.id, id))
      .limit(1)
  )[0];
  if (!existing) return c.json({ error: "Not found" }, 404);
  // Blocked by the FK while links still point at it — surface a clear message.
  try {
    await c.var.db.delete(domains).where(eq(domains.id, id));
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } } | null;
    if (err?.code === "23503" || err?.cause?.code === "23503") {
      return c.json({ error: "That domain still has links — remove them first" }, 409);
    }
    throw e;
  }
  await invalidateDomainHost(c.env.LINKS_KV, existing.hostname);
  // Release the Cloudflare-for-SaaS hostname too, so a removed domain stops
  // routing (the cron cleanup does this — manual admin delete must match it).
  if (existing.cfHostnameId) {
    const map = await getAllSettings(c.var.db, c.var.schema);
    const saas = await saasConfigFrom(map, c.env.APP_URL, c.env.SESSION_SECRET);
    if (saas) {
      c.executionCtx.waitUntil(
        deleteCustomHostname(saas, existing.cfHostnameId).catch(() => {}),
      );
    }
  }
  return c.json({ ok: true });
});

// Remove a member — same soft-delete lifecycle as self-service account closure
// (links stop, credentials die, the email is tombstoned, purge by cron).
// The primary admin and your own account are protected.
admin.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  if (!id || !UUID_RE.test(id)) return c.json({ error: "Not found" }, 404);
  if (id === c.var.user!.id) {
    return c.json({ error: "You can't delete your own account" }, 400);
  }

  const { users } = c.var.schema;
  const rows = await c.var.db
    .select({ isPrimary: users.isPrimary })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  const target = rows[0];
  if (!target) return c.json({ error: "Not found" }, 404);
  if (target.isPrimary) {
    return c.json({ error: "The primary admin can't be deleted" }, 403);
  }

  await softDeleteUser(c.env, c.var.db, c.var.schema, id);
  return c.json({ ok: true });
});

export default admin;
