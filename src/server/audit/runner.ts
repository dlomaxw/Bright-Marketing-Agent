import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { normalizeUrl } from '@/lib/normalize';
import type { CheckGroup, Platform } from '@/lib/enums';
import { fetchPage, getRobots, parseRobots, robotsAllows } from '@/audit/fetcher';
import { ENGINE_VERSION, GROUP_RUNNERS } from '@/audit/registry';
import { buildGbpReview, buildSocialReview } from '@/audit/checks/social';
import type { AuditContext, FetchedPage, ObservationDraft } from '@/audit/types';
import { classifyObservations, markResolvedFindings } from '@/server/findings/classify';
import { recomputeScores } from '@/server/scoring/recompute';
import { logActivity } from '@/server/activity';

/**
 * Executes one audit job (a single check group) against one organization.
 *
 * Each group gets a fresh context but shares the fetch budget for the run, so a
 * single audit can never hammer a prospect's server. Budget exhaustion produces
 * `skipped` observations - never a silently missing check.
 */

interface RunBudget {
  remaining: number;
}

async function buildContext(
  organization: {
    id: string;
    legalName: string;
    brandName: string | null;
    website: string | null;
    country: string;
    city: string | null;
  },
  targetUrl: string,
  budget: RunBudget,
  cache: Map<string, FetchedPage>,
): Promise<AuditContext> {
  const origin = new URL(targetUrl).origin;
  const robotsBody = await getRobots(origin);
  const robotsRule = parseRobots(robotsBody, env.AUDIT_USER_AGENT);

  const fetchWithBudget = async (
    url: string,
    opts?: { method?: 'GET' | 'HEAD' },
  ): Promise<FetchedPage | null> => {
    const key = `${opts?.method ?? 'GET'} ${url}`;
    const cached = cache.get(key);
    if (cached) return cached;
    if (budget.remaining <= 0) return null;
    budget.remaining -= 1;
    const page = await fetchPage(url, { method: opts?.method, robotsRule });
    cache.set(key, page);
    return page;
  };

  const rootKey = `GET ${targetUrl}`;
  let root = cache.get(rootKey);
  if (!root) {
    budget.remaining -= 1;
    root = await fetchPage(targetUrl, { robotsRule });
    cache.set(rootKey, root);
  }

  return {
    organizationId: organization.id,
    organizationName: organization.brandName ?? organization.legalName,
    country: organization.country,
    city: organization.city,
    targetUrl,
    origin,
    root,
    pages: new Map(),
    robots: {
      fetched: robotsBody !== null,
      body: robotsBody,
      allowsRoot: robotsAllows(robotsRule, new URL(targetUrl).pathname),
    },
    fetch: fetchWithBudget,
    now: new Date(),
  };
}

async function persistObservations(
  auditRunId: string,
  drafts: ObservationDraft[],
): Promise<{ id: string; checkCode: string; outcome: string; url: string | null; detail: string | null; observedAt: Date }[]> {
  const saved: {
    id: string;
    checkCode: string;
    outcome: string;
    url: string | null;
    detail: string | null;
    observedAt: Date;
  }[] = [];

  for (const draft of drafts) {
    const observedAt = draft.observedAt ?? new Date();
    const row = await db.observation.create({
      data: {
        auditRunId,
        groupCode: draft.groupCode,
        checkCode: draft.checkCode,
        outcome: draft.outcome,
        url: draft.url ?? null,
        rawValueJson: JSON.stringify(draft.rawValue ?? {}),
        detail: draft.detail ?? null,
        reason: draft.reason ?? null,
        source: draft.source ?? 'automated',
        observedAt,
      },
    });

    for (const ev of draft.evidence ?? []) {
      await db.evidence.create({
        data: {
          observationId: row.id,
          kind: ev.kind,
          sourceUrl: ev.sourceUrl ?? draft.url ?? null,
          contentType: ev.contentType ?? null,
          content: ev.content?.slice(0, 20_000) ?? null,
          bytes: ev.bytes ?? null,
          capturedAt: observedAt,
        },
      });
    }

    saved.push({
      id: row.id,
      checkCode: row.checkCode,
      outcome: row.outcome,
      url: row.url,
      detail: row.detail,
      observedAt: row.observedAt,
    });
  }
  return saved;
}

/** Runs every queued job for a run that is ready. Returns the number processed. */
export async function processAuditJob(jobId: string): Promise<void> {
  const job = await db.auditJob.findUnique({
    where: { id: jobId },
    include: { auditRun: { include: { organization: true } } },
  });
  if (!job || job.status === 'completed') return;

  const run = job.auditRun;
  const org = run.organization;

  await db.auditJob.update({
    where: { id: job.id },
    data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (run.status === 'queued') {
    await db.auditRun.update({
      where: { id: run.id },
      data: { status: 'running', startedAt: new Date() },
    });
  }

  const group = job.groupCode as CheckGroup;

  try {
    let drafts: ObservationDraft[] = [];

    if (group === 'social' || group === 'gbp') {
      const profiles = await db.platformProfile.findMany({
        where: { organizationId: org.id },
      });
      drafts =
        group === 'social'
          ? buildSocialReview(
              profiles.map((p) => ({
                id: p.id,
                platform: p.platform as Platform,
                url: p.url,
                handle: p.handle,
              })),
            )
          : buildGbpReview(
              profiles
                .filter((p) => p.platform === 'google_business')
                .map((p) => ({ id: p.id, url: p.url }))[0] ?? null,
              org.brandName ?? org.legalName,
            );
    } else {
      const target = normalizeUrl(run.targetUrl ?? org.website);
      if (!target) {
        drafts = [
          {
            groupCode: group,
            checkCode: `${group}.group`,
            outcome: 'skipped',
            reason: 'No valid website address is recorded for this organization.',
          },
        ];
      } else {
        const budget: RunBudget = { remaining: env.AUDIT_MAX_PAGES_PER_RUN };
        const cache = new Map<string, FetchedPage>();
        const ctx = await buildContext(org, target, budget, cache);
        const runner = GROUP_RUNNERS[group];
        drafts = runner ? await runner.run(ctx) : [];
      }
    }

    const saved = await persistObservations(run.id, drafts);
    const classification = await classifyObservations({
      organizationId: org.id,
      auditRunId: run.id,
      observations: saved,
    });
    await markResolvedFindings(org.id, drafts);

    /**
     * One screenshot of the audited page, attached to the findings this run
     * produced.
     *
     * Taken once per run rather than once per finding: it is another request
     * to someone else's server, and the crawler's politeness rules do not stop
     * applying because the request comes from a different function. Several
     * findings about the same page share the one capture.
     *
     * A failure here is recorded as nothing at all — no picture, no
     * substitute. A page that would not load is itself usually the finding.
     */
    const captureUrl = run.targetUrl ?? org.website;
    if (captureUrl && classification.created > 0) {
      const { captureScreenshot, captureConfigured } = await import('@/audit/capture');
      if (captureConfigured()) {
        const primary = await db.finding.findFirst({
          where: { organizationId: org.id, auditRunId: run.id, deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (primary) {
          await captureScreenshot({ url: captureUrl, findingId: primary.id }).catch(() => undefined);
        }
      }
    }

    // Social profiles the site links to are recorded automatically. The
    // business is telling us which accounts are theirs, on a page we already
    // fetched, so the URL is evidence rather than a guess — and it is what
    // makes the social review possible at all.
    const socialLinks = drafts
      .filter((d) => d.checkCode === 'social.links_present' || d.checkCode === 'social.links_broken')
      .flatMap((d) => {
        const raw = (d.rawValue as { links?: unknown } | undefined)?.links;
        return Array.isArray(raw) ? raw.filter((l): l is string => typeof l === 'string') : [];
      });

    if (socialLinks.length > 0) {
      const { recordDiscoveredProfiles } = await import('@/server/leads/social-discovery');
      await recordDiscoveredProfiles(
        org.id,
        socialLinks,
        run.targetUrl ?? org.website ?? 'the audited website',
        run.requestedById ?? undefined,
      ).catch(() => undefined); // Discovery is a bonus; it must not fail the run.
    }

    await db.auditJob.update({
      where: { id: job.id },
      data: { status: 'completed', finishedAt: new Date(), error: null },
    });

    if (classification.unmapped.length > 0) {
      // Visible in the activity log so the catalogue can be extended deliberately.
      await logActivity({
        organizationId: org.id,
        action: 'audit.unmapped_check',
        entityType: 'audit_run',
        entityId: run.id,
        reason: `Check codes produced an issue with no catalogue rule: ${[...new Set(classification.unmapped)].join(', ')}`,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = job.attempts + 1 >= job.maxAttempts;
    await db.auditJob.update({
      where: { id: job.id },
      data: {
        status: failed ? 'failed' : 'queued',
        error: message.slice(0, 1000),
        finishedAt: failed ? new Date() : null,
        runAfter: failed ? job.runAfter : new Date(Date.now() + 30_000),
      },
    });
  }

  await finaliseRunIfComplete(run.id);
}

async function finaliseRunIfComplete(auditRunId: string): Promise<void> {
  const jobs = await db.auditJob.findMany({ where: { auditRunId } });
  const done = jobs.every((j) => j.status === 'completed' || j.status === 'failed');
  if (!done) return;

  const failedCount = jobs.filter((j) => j.status === 'failed').length;
  const observations = await db.observation.groupBy({
    by: ['outcome'],
    where: { auditRunId },
    _count: true,
  });
  const stats = Object.fromEntries(observations.map((o) => [o.outcome, o._count]));

  const run = await db.auditRun.update({
    where: { id: auditRunId },
    data: {
      status: failedCount === jobs.length ? 'failed' : failedCount > 0 ? 'partial' : 'completed',
      completedAt: new Date(),
      statsJson: JSON.stringify(stats),
      errorMessage:
        failedCount > 0 ? `${failedCount} of ${jobs.length} check groups did not complete.` : null,
    },
  });

  await recomputeScores(run.organizationId);

  const org = await db.organization.findUnique({ where: { id: run.organizationId } });
  if (org && ['new', 'researching', 'audit_in_progress'].includes(org.stage)) {
    const needsReview = await db.finding.count({
      where: {
        organizationId: org.id,
        deletedAt: null,
        verificationStatus: { in: ['auto_detected', 'needs_review'] },
      },
    });
    await db.organization.update({
      where: { id: org.id },
      data: { stage: needsReview > 0 ? 'needs_verification' : 'audit_completed' },
    });
  }

  await logActivity({
    organizationId: run.organizationId,
    action: 'audit.completed',
    entityType: 'audit_run',
    entityId: run.id,
    newValue: stats,
  });
}

/**
 * Claims and processes queued jobs. Called by the standalone worker and, in
 * development, opportunistically after an audit is requested so a single
 * `npm run dev` is enough to see results.
 */
export async function drainQueue(limit = 10): Promise<number> {
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const next = await db.auditJob.findFirst({
      where: { status: 'queued', runAfter: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
    });
    if (!next) break;

    // Optimistic claim: only proceed if this process won the row.
    const claimed = await db.auditJob.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'claimed', claimedAt: new Date(), claimedBy: process.pid.toString() },
    });
    if (claimed.count === 0) continue;

    await processAuditJob(next.id);
    processed += 1;
  }
  return processed;
}

export async function createAuditRun(args: {
  organizationId: string;
  groups: CheckGroup[];
  requestedById: string;
  targetUrl?: string | null;
}): Promise<{ id: string }> {
  const org = await db.organization.findUnique({ where: { id: args.organizationId } });
  if (!org) throw new Error('Organization not found.');

  const target = normalizeUrl(args.targetUrl ?? org.website);

  const run = await db.auditRun.create({
    data: {
      organizationId: org.id,
      requestedById: args.requestedById,
      targetUrl: target,
      scopeJson: JSON.stringify(args.groups),
      status: 'queued',
      engineVersion: ENGINE_VERSION,
      jobs: { create: args.groups.map((groupCode) => ({ groupCode })) },
    },
  });

  await db.organization.update({
    where: { id: org.id },
    data: { stage: ['new', 'researching'].includes(org.stage) ? 'audit_in_progress' : org.stage },
  });

  await logActivity({
    organizationId: org.id,
    actorId: args.requestedById,
    action: 'audit.started',
    entityType: 'audit_run',
    entityId: run.id,
    newValue: { groups: args.groups, targetUrl: target },
  });

  return { id: run.id };
}
