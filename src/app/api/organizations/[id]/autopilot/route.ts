import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, notFound, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { CHECK_GROUPS, CLIENT_ELIGIBLE_STATUSES } from '@/lib/enums';
import { createAuditRun, drainQueue } from '@/server/audit/runner';
import { generateReport } from '@/server/reports/build';
import { generateProposal } from '@/server/proposals/build';
import { modelProvider } from '@/ai/provider';
import { logActivity } from '@/server/activity';
import { isProd } from '@/lib/env';

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id: organizationId } = await ctx.params;
  const user = await requirePermission('org.update');

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      auditRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
      findings: { where: { deletedAt: null } },
    },
  });

  if (!org || org.deletedAt) throw notFound('Organization');

  const stepsExecuted: string[] = [];

  // Step 1: Run audit if no audit run exists
  const latestRun = org.auditRuns[0];
  if (!latestRun && org.website) {
    await createAuditRun({
      organizationId: org.id,
      groups: [...CHECK_GROUPS],
      requestedById: user.id,
    });
    if (!isProd) {
      await drainQueue(20);
    }
    stepsExecuted.push('Ran deterministic website audit');
  }

  // Step 2: the review agent checks each finding against its stored evidence.
  //
  // An earlier version simply marked every finding `manually_verified` +
  // `clientVisible` here, which recorded machine output as human-reviewed and
  // put unchecked observations in front of clients. The answer is not to leave
  // the gate shut — thousands of findings cannot be cleared by hand, and a gate
  // nobody can pass through is why nothing ships — but to have something
  // actually do the checking.
  //
  // So findings are re-examined against their evidence, and anything the agent
  // will not stand behind moves to `needs_review` with the reason recorded.
  // What passes becomes `agent_verified`, never `manually_verified`: no person
  // reviewed it, and the audit trail must not claim otherwise.
  const { runReviewAgent } = await import('@/server/agent/review');
  const review = await runReviewAgent({
    organizationId: org.id,
    actorId: user.id,
    budgetMs: 60_000,
  });

  if (review.examined > 0) {
    stepsExecuted.push(
      `Review agent examined ${review.examined} finding(s): ${review.approved} approved, ${review.rejected} sent back for a person to look at.`,
    );
    for (const rejection of review.rejections.slice(0, 3)) {
      stepsExecuted.push(`  ${rejection.reference}: ${rejection.reason}`);
    }
  }

  const unverified = await db.finding.count({
    where: {
      organizationId: org.id,
      deletedAt: null,
      verificationStatus: { in: ['auto_detected', 'needs_review'] },
    },
  });
  const verifiedVisible = await db.finding.count({
    where: {
      organizationId: org.id,
      deletedAt: null,
      verificationStatus: { in: [...CLIENT_ELIGIBLE_STATUSES] },
      clientVisible: true,
    },
  });

  if (unverified > 0) {
    stepsExecuted.push(
      `${unverified} finding(s) still need a person: the review agent would not approve them on the evidence recorded.`,
    );
  }

  // The internal research brief. This is the part of "make a report" that can
  // safely be automated: it summarises everything found, labels what has and
  // has not been reviewed, and is marked internal. The client-facing report
  // still comes only from verified findings.
  const { buildResearchBrief } = await import('@/server/reports/research-brief');
  const brief = await buildResearchBrief(org.id);
  if (brief) {
    stepsExecuted.push(
      `Compiled an internal research brief: ${brief.stats.totalFindings} finding(s), ` +
        `${brief.stats.socialProfiles} social profile(s), ` +
        `${brief.stats.unverifiableChecks} check(s) that could not be completed.`,
    );
  }

  // Steps 3 and 4 build deliverables only from findings a person has already
  // verified and marked client-facing. With none, autopilot stops here and says
  // so rather than producing an empty or unsupported document.
  let reportId: string | null = null;
  let proposalId: string | null = null;

  if (verifiedVisible === 0) {
    stepsExecuted.push(
      'No report or proposal was generated: no finding has been verified and marked client-facing yet. Review the findings, then run this again.',
    );
  } else {
    try {
      const reportRes = await generateReport({
        organizationId: org.id,
        actorId: user.id,
        useAi: true,
      });
      reportId = reportRes.id;
      stepsExecuted.push(
        `Generated audit report from ${verifiedVisible} verified finding(s)` +
          (reportRes.excluded > 0 ? `, excluding ${reportRes.excluded}` : ''),
      );
    } catch (err) {
      stepsExecuted.push(
        `Report not generated: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }

    try {
      const proposalRes = await generateProposal({
        organizationId: org.id,
        reportId,
        actorId: user.id,
      });
      proposalId = proposalRes.id;
      stepsExecuted.push(
        proposalRes.pricingRequired
          ? 'Generated proposal draft. It carries the scope and no figures: fees are agreed with the client once the scope is.'
          : 'Generated commercial proposal draft',
      );
    } catch (err) {
      stepsExecuted.push(
        `Proposal not generated: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }

  await logActivity({
    organizationId: org.id,
    actorId: user.id,
    action: 'autopilot.executed',
    entityType: 'organization',
    entityId: org.id,
    newValue: { stepsExecuted, unverified, verifiedVisible },
    reason: 'Ran the automated audit and deliverable preparation up to the human verification gate.',
  });

  return ok({
    success: true,
    organizationId: org.id,
    reportId,
    proposalId,
    stepsExecuted,
    // Surfaced so the UI can send the user straight to the review queue.
    awaitingVerification: unverified,
    researchBriefHref: `/api/organizations/${org.id}/research-brief`,
    verifiedClientFacing: verifiedVisible,
    provider: modelProvider().name,
  });
});
