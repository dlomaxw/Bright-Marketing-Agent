import { db } from '@/lib/db';
import { CHECK_GROUPS, CLIENT_ELIGIBLE_STATUSES } from '@/lib/enums';
import type { Role } from '@/lib/enums';
import { createAuditRun, drainQueue } from '@/server/audit/runner';
import { recomputeScores } from '@/server/scoring/recompute';
import { buildResearchBrief } from '@/server/reports/research-brief';
import { generateReport } from '@/server/reports/build';
import { generateProposal } from '@/server/proposals/build';
import { purgeExpiredSessions } from '@/server/auth/session';
import { logActivity } from '@/server/activity';

/**
 * The scheduled agent: research, audit and draft preparation, unattended.
 *
 * Why this exists. In development the API drains the audit queue inline; in
 * production the deployment guide says to run `npm run worker` as a separate
 * process. A serverless host has no such process, so every audit queued in
 * production stayed queued — 9 runs and 81 jobs sat untouched for eight hours
 * before this was written. A queue with nothing draining it is not a slow
 * queue, it is a broken feature, and nothing downstream of the audit can
 * happen at all.
 *
 * What it deliberately does NOT do:
 *
 *   - It never marks a finding `manually_verified`. The review agent it calls
 *     approves findings as `agent_verified`, a separate status, because no
 *     person reviewed them and the audit trail must not say one did. An earlier
 *     autopilot wrote `manually_verified` directly; it was the most serious
 *     defect found in this codebase.
 *   - It never sends email. Reports and proposals are produced as drafts and
 *     wait for approval like any other.
 *
 * So the agent can run every day without supervision and still cannot put an
 * unreviewed word in front of a prospect. What it produces is a queue of work
 * ready for a person, not finished client-facing output.
 *
 * Every step is bounded by a wall-clock deadline because the host will kill the
 * function mid-flight otherwise. Partial progress is the design: whatever is
 * not reached today is picked up tomorrow, and each step reports what it did.
 */

export interface DailyAgentOptions {
  /** Wall-clock budget. The run stops cleanly before the host kills it. */
  budgetMs?: number;
  /** Cap on audits queued per run, so one day cannot flood the crawler. */
  maxNewAudits?: number;
  /** Cap on jobs drained per run. */
  maxJobs?: number;
  /**
   * The account the run is attributed to. Omitted, the agent resolves one —
   * see resolveAgentActor. Every audit, report and proposal records who
   * requested it, and "nobody" is not an answer an audit trail can use.
   */
  actorId?: string;
}

export interface DailyAgentResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ranOutOfTime: boolean;
  steps: string[];
  counts: {
    jobsProcessed: number;
    auditsQueued: number;
    briefsBuilt: number;
    scoresRecomputed: number;
    reportsDrafted: number;
    proposalsDrafted: number;
    jobsReclaimed: number;
    sessionsPurged: number;
    findingsApproved: number;
    findingsSentBack: number;
    socialChecked: number;
    socialFindings: number;
    emailsDrafted: number;
    findingsRetired: number;
  };
  /** Work a person must do before anything can reach a client. */
  awaitingHumanReview: {
    findingsUnverified: number;
    organizationsWithFindings: number;
    reportsAwaitingApproval: number;
    proposalsAwaitingApproval: number;
  };
}

const DEFAULTS = {
  budgetMs: 240_000,
  maxNewAudits: 15,
  maxJobs: 40,
};

/**
 * Finds the account scheduled work is recorded against.
 *
 * Prefers a dedicated automation account, so unattended activity is
 * distinguishable in the log from anything a person did. Falls back to a senior
 * approver, then any administrator. If the database has neither, the run stops:
 * unattributed audits of third-party websites are not something to write.
 */
export async function resolveAgentActor(): Promise<string> {
  const automation = await db.user.findFirst({
    where: { email: { startsWith: 'automation@' }, status: 'active', deletedAt: null },
    select: { id: true },
  });
  if (automation) return automation.id;

  const admin = await db.user.findFirst({
    where: { status: 'active', deletedAt: null, roleCode: 'admin' },
    orderBy: [{ seniorApprover: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (admin) return admin.id;

  throw new Error(
    'No active administrator to attribute the scheduled run to. Create one with scripts/create-user.ts before enabling the schedule.',
  );
}

export async function runDailyAgent(options: DailyAgentOptions = {}): Promise<DailyAgentResult> {
  const budgetMs = options.budgetMs ?? DEFAULTS.budgetMs;
  const maxNewAudits = options.maxNewAudits ?? DEFAULTS.maxNewAudits;
  const maxJobs = options.maxJobs ?? DEFAULTS.maxJobs;
  const actorId = options.actorId ?? (await resolveAgentActor());

  const startedAt = new Date();
  const deadline = startedAt.getTime() + budgetMs;
  const timeLeft = () => deadline - Date.now();
  /** Leaves room to finish the current unit of work and write the summary. */
  const hasTime = (reserveMs = 20_000) => timeLeft() > reserveMs;

  const steps: string[] = [];
  const counts: DailyAgentResult['counts'] = {
    jobsProcessed: 0,
    auditsQueued: 0,
    briefsBuilt: 0,
    scoresRecomputed: 0,
    reportsDrafted: 0,
    proposalsDrafted: 0,
    jobsReclaimed: 0,
    sessionsPurged: 0,
    findingsApproved: 0,
    findingsSentBack: 0,
    socialChecked: 0,
    socialFindings: 0,
    emailsDrafted: 0,
    findingsRetired: 0,
  };

  // --- 1. Housekeeping ------------------------------------------------------
  // A job claimed by a function that was killed mid-flight would otherwise be
  // stuck forever. Serverless makes that ordinary, not exceptional.
  const reclaimed = await db.auditJob.updateMany({
    where: {
      status: { in: ['claimed', 'running'] },
      claimedAt: { lt: new Date(Date.now() - 10 * 60_000) },
    },
    data: { status: 'queued', claimedAt: null, claimedBy: null },
  });
  counts.jobsReclaimed = reclaimed.count;
  if (reclaimed.count > 0) {
    steps.push(`Returned ${reclaimed.count} stalled audit job(s) to the queue.`);
  }

  counts.sessionsPurged = await purgeExpiredSessions();

  // --- 2. Drain the audit queue --------------------------------------------
  // Existing work first. Queueing more before clearing the backlog would only
  // grow it.
  while (hasTime(30_000) && counts.jobsProcessed < maxJobs) {
    const processed = await drainQueue(1);
    if (processed === 0) break;
    counts.jobsProcessed += processed;
  }
  if (counts.jobsProcessed > 0) {
    steps.push(`Processed ${counts.jobsProcessed} audit job(s).`);
  }

  // --- 3. Queue audits for organizations that have never had one ------------
  // Only where a website is recorded: the crawler has nothing to fetch
  // otherwise, and an audit of nothing produces no evidence.
  if (hasTime(30_000)) {
    const candidates = await db.organization.findMany({
      where: {
        deletedAt: null,
        website: { not: null },
        auditRuns: { none: {} },
      },
      orderBy: [{ opportunityScore: 'desc' }, { createdAt: 'asc' }],
      take: maxNewAudits,
      select: { id: true },
    });

    for (const org of candidates) {
      if (!hasTime(25_000)) break;
      try {
        await createAuditRun({
          organizationId: org.id,
          groups: [...CHECK_GROUPS],
          requestedById: actorId,
        });
        counts.auditsQueued += 1;
      } catch {
        // One organization failing must not end the run.
      }
    }
    if (counts.auditsQueued > 0) {
      steps.push(`Queued ${counts.auditsQueued} new website audit(s).`);
    }
  }

  // --- 4. Rescore organizations whose findings changed today ----------------
  if (hasTime(25_000)) {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const changed = await db.finding.findMany({
      where: { deletedAt: null, updatedAt: { gte: since } },
      select: { organizationId: true },
      distinct: ['organizationId'],
      take: 200,
    });
    for (const row of changed) {
      if (!hasTime(20_000)) break;
      try {
        await recomputeScores(row.organizationId);
        counts.scoresRecomputed += 1;
      } catch {
        // Scoring is advisory; a failure must not stop the run.
      }
    }
    if (counts.scoresRecomputed > 0) {
      steps.push(`Recomputed scores for ${counts.scoresRecomputed} organization(s).`);
    }
  }

  // --- 4b. Review the findings the audits produced ---------------------------
  // The review agent re-checks each finding against its stored evidence and
  // approves only what that evidence supports. Everything else moves to
  // needs_review with the reason recorded, so the human queue holds the cases
  // that genuinely need judgement rather than all of them.
  if (hasTime(45_000)) {
    const { runReviewAgent } = await import('@/server/agent/review');
    const review = await runReviewAgent({
      actorId,
      budgetMs: Math.min(60_000, Math.max(15_000, timeLeft() - 40_000)),
      limit: 200,
    });
    counts.findingsApproved = review.approved;
    counts.findingsSentBack = review.rejected;
    if (review.examined > 0) {
      steps.push(
        `Review agent examined ${review.examined} finding(s): ${review.approved} approved on the evidence, ${review.rejected} sent back for a person.`,
      );
    }
  }

  // --- 5. Internal research briefs ------------------------------------------
  // This is the part of "write it up" that can be automated honestly: it
  // summarises what was found and labels what has not been reviewed. It is an
  // internal working document, never a client deliverable.
  if (hasTime(25_000)) {
    const withFindings = await db.organization.findMany({
      where: { deletedAt: null, findings: { some: { deletedAt: null } } },
      orderBy: { updatedAt: 'desc' },
      take: 25,
      select: { id: true },
    });
    for (const org of withFindings) {
      if (!hasTime(20_000)) break;
      try {
        const brief = await buildResearchBrief(org.id);
        if (brief) counts.briefsBuilt += 1;
      } catch {
        // A brief that cannot be built is not a reason to stop.
      }
    }
    if (counts.briefsBuilt > 0) {
      steps.push(`Compiled ${counts.briefsBuilt} internal research brief(s).`);
    }
  }

  // --- 6. Drafts, but only from findings a person has already verified ------
  //
  // The gate. `manually_verified` + `clientVisible` are set by a human through
  // the findings endpoint and nowhere else. This step reads that state; it
  // never writes it. Where nobody has verified anything, nothing is drafted,
  // and the summary says so rather than producing an empty document.
  if (hasTime(40_000)) {
    const ready = await db.organization.findMany({
      where: {
        deletedAt: null,
        findings: {
          some: {
            deletedAt: null,
            verificationStatus: { in: [...CLIENT_ELIGIBLE_STATUSES] },
            clientVisible: true,
          },
        },
      },
      orderBy: { opportunityScore: 'desc' },
      take: 10,
      select: {
        id: true,
        reports: { where: { deletedAt: null }, select: { id: true, status: true } },
        proposals: { where: { deletedAt: null }, select: { id: true } },
      },
    });

    for (const org of ready) {
      if (!hasTime(35_000)) break;

      let reportId: string | null = org.reports[0]?.id ?? null;

      if (org.reports.length === 0) {
        try {
          const res = await generateReport({ organizationId: org.id, actorId, useAi: true });
          reportId = res.id;
          counts.reportsDrafted += 1;
        } catch {
          // Report generation refuses on stale or insufficient evidence. That
          // is the safeguard working, not an error to retry blindly.
        }
      }

      // A proposal needs an approved report. Approval is a human decision, so
      // most days this will correctly do nothing.
      const approvedReport = org.reports.find((r) => r.status === 'approved');
      if (approvedReport && org.proposals.length === 0 && hasTime(30_000)) {
        try {
          await generateProposal({
            organizationId: org.id,
            reportId: approvedReport.id,
            actorId,
          });
          counts.proposalsDrafted += 1;
        } catch {
          // Same reasoning as above.
        }
      }
    }

    if (counts.reportsDrafted > 0) {
      steps.push(`Drafted ${counts.reportsDrafted} audit report(s) from verified findings.`);
    }
    if (counts.proposalsDrafted > 0) {
      steps.push(
        `Drafted ${counts.proposalsDrafted} proposal(s) from approved reports. Every fee must still be set by an authorised person.`,
      );
    }
  }

  // --- 6b. Social and review research ---------------------------------------
  // Google reviews and audience figures where a platform permits reading them.
  // Everything a platform will not expose is returned as a stated reason, not
  // an estimate, and lands in the organization's manual-review list.
  if (hasTime(45_000)) {
    const { runReviewAudit } = await import('@/server/leads/review-audit');
    const withProfiles = await db.organization.findMany({
      where: { deletedAt: null, profiles: { some: {} } },
      orderBy: { updatedAt: 'asc' },
      take: 10,
      select: { id: true },
    });
    for (const org of withProfiles) {
      if (!hasTime(35_000)) break;
      try {
        const res = await runReviewAudit(org.id, actorId);
        counts.socialChecked += 1;
        counts.socialFindings += res.findingsCreated;
      } catch {
        // A platform refusing us is not a reason to stop the run.
      }
    }
    if (counts.socialChecked > 0) {
      steps.push(
        `Checked reviews and audiences for ${counts.socialChecked} organization(s); ${counts.socialFindings} finding(s) recorded.`,
      );
    }
  }

  // --- 6c. Outreach drafts ---------------------------------------------------
  //
  // Drafts only, and only where an approved proposal already exists. The draft
  // is written, the eleven send gates are evaluated against it when someone
  // tries to send, and a person still approves the recipient. Nothing here
  // transmits anything.
  if (hasTime(40_000)) {
    const { createEmailDraft } = await import('@/server/emails/draft');
    const actor = await db.user.findUnique({
      where: { id: actorId },
      select: {
        id: true,
        name: true,
        email: true,
        roleCode: true,
        seniorApprover: true,
        signature: true,
      },
    });

    if (actor) {
      const readyForOutreach = await db.organization.findMany({
        where: {
          deletedAt: null,
          proposals: { some: { deletedAt: null, status: 'approved' } },
          emailDrafts: { none: { deletedAt: null } },
          contacts: { some: { deletedAt: null, optedOut: false } },
        },
        take: 5,
        select: {
          id: true,
          proposals: {
            where: { deletedAt: null, status: 'approved' },
            orderBy: { version: 'desc' },
            take: 1,
            select: { id: true, reportId: true },
          },
        },
      });

      for (const org of readyForOutreach) {
        if (!hasTime(30_000)) break;
        try {
          await createEmailDraft({
            organizationId: org.id,
            proposalId: org.proposals[0]?.id ?? null,
            reportId: org.proposals[0]?.reportId ?? null,
            // The full session shape, not a cast. The draft signs off with
            // this user's signature, so a missing field would silently produce
            // an unsigned message to a real business.
            user: {
              id: actor.id,
              name: actor.name,
              email: actor.email,
              role: actor.roleCode as Role,
              seniorApprover: actor.seniorApprover,
              signature: actor.signature,
            },
          });
          counts.emailsDrafted += 1;
        } catch {
          // Drafting refuses on a missing contact or stale evidence. That is
          // the gate working, not an error worth retrying.
        }
      }
      if (counts.emailsDrafted > 0) {
        steps.push(
          `Drafted ${counts.emailsDrafted} outreach email(s). Every one waits for a person to approve the recipient before anything is sent.`,
        );
      }
    }
  }

  // --- 6d. Retire evidence that is too old to support a claim ----------------
  //
  // A finding whose evidence has aged past the freshness window is no longer
  // something we can put in front of a business: the site may have been fixed.
  // Marking it `outdated` removes it from client-facing use and puts it back in
  // the queue for a fresh look, rather than letting a stale claim go out.
  if (hasTime(25_000)) {
    const freshnessHours = Number(process.env.EVIDENCE_FRESHNESS_HOURS ?? 168);
    const staleBefore = new Date(Date.now() - freshnessHours * 3_600_000);
    const stale = await db.finding.updateMany({
      where: {
        deletedAt: null,
        clientVisible: true,
        verificationStatus: { in: [...CLIENT_ELIGIBLE_STATUSES] },
        observedAt: { lt: staleBefore },
      },
      data: { verificationStatus: 'outdated', clientVisible: false },
    });
    counts.findingsRetired = stale.count;
    if (stale.count > 0) {
      steps.push(
        `Retired ${stale.count} finding(s) whose evidence aged past the freshness window. They are no longer client-facing and need re-observing.`,
      );
    }
  }

  // --- 7. What a person has to do next --------------------------------------
  const [findingsUnverified, organizationsWithFindings, reportsAwaiting, proposalsAwaiting] =
    await Promise.all([
      db.finding.count({
        where: { deletedAt: null, verificationStatus: { in: ['auto_detected', 'needs_review'] } },
      }),
      db.organization.count({
        where: {
          deletedAt: null,
          findings: {
            some: { deletedAt: null, verificationStatus: { in: ['auto_detected', 'needs_review'] } },
          },
        },
      }),
      db.report.count({ where: { deletedAt: null, status: 'pending_approval' } }),
      db.proposal.count({ where: { deletedAt: null, status: 'pending_approval' } }),
    ]);

  if (findingsUnverified > 0) {
    steps.push(
      `${findingsUnverified} finding(s) across ${organizationsWithFindings} organization(s) are waiting for human verification. The agent does not verify findings.`,
    );
  }

  const finishedAt = new Date();
  const ranOutOfTime = timeLeft() <= 20_000;
  if (ranOutOfTime) {
    steps.push('Stopped on the time budget. Remaining work is picked up on the next run.');
  }
  if (steps.length === 0) {
    steps.push('Nothing to do: no queued audits, no organizations without one, no findings changed.');
  }

  const result: DailyAgentResult = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    ranOutOfTime,
    steps,
    counts,
    awaitingHumanReview: {
      findingsUnverified,
      organizationsWithFindings,
      reportsAwaitingApproval: reportsAwaiting,
      proposalsAwaitingApproval: proposalsAwaiting,
    },
  };

  await logActivity({
    actorId,
    action: 'agent.daily_run',
    entityType: 'system',
    entityId: 'daily-agent',
    newValue: { counts: result.counts, ranOutOfTime, durationMs: result.durationMs },
    reason: 'Scheduled research and audit cycle.',
  });

  return result;
}
