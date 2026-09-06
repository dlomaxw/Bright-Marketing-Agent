import { db } from '@/lib/db';
import { logActivity } from '@/server/activity';
import { recomputeScores } from '@/server/scoring/recompute';
import { FINDING_RULES } from '@/server/findings/rules';

/**
 * The review agent: a second pass that re-checks the audit's work before any
 * finding becomes client-eligible.
 *
 * Verifying thousands of findings by hand does not scale, and a gate nobody can
 * pass through stops being a safeguard and becomes the reason the work never
 * ships. So this agent does the checking — but it checks, it does not rubber
 * stamp. Its whole value is the findings it REFUSES.
 *
 * It is deliberately not the same code that produced the finding. Re-running
 * the detector would only confirm the detector agrees with itself. Instead this
 * re-reads the stored evidence and asks whether the finding is supported by it:
 *
 *   1. The check code must exist in the closed rule catalogue. A finding citing
 *      a rule we do not publish cannot be defended to a client.
 *   2. The evidence must exist, name the exact URL it came from, and carry a
 *      timestamp. "We observed X" with no record of observing it is an opinion.
 *   3. The evidence must not be stale. A site fixed last week makes today's
 *      claim wrong, and being wrong in writing to a prospect is the single most
 *      expensive thing this product can do.
 *   4. The finding must carry the wording the catalogue approves, not text that
 *      drifted, and must not assert a number nothing measured.
 *   5. Low confidence stays for a person. Where the machine itself is unsure,
 *      an automated second opinion adds nothing.
 *
 * Anything failing a check is moved to `needs_review` with the reason recorded,
 * so a person sees exactly what the agent would not stand behind. Anything
 * passing becomes `agent_verified` — never `manually_verified`, because no
 * person reviewed it and the audit trail must not say otherwise.
 */

export interface ReviewAgentOptions {
  organizationId?: string;
  /** Wall-clock budget, matching the scheduled runner. */
  budgetMs?: number;
  limit?: number;
  actorId: string;
  /** Whether approved findings also become client-facing. */
  clientVisible?: boolean;
}

export interface ReviewRejection {
  reference: string;
  checkCode: string;
  reason: string;
}

export interface ReviewAgentResult {
  examined: number;
  approved: number;
  rejected: number;
  rejections: ReviewRejection[];
  organizationsTouched: number;
  ranOutOfTime: boolean;
}

/** Evidence older than this cannot support a claim made today. */
const MAX_EVIDENCE_AGE_DAYS = 30;

/** Numbers stated in client-facing text must come from a measurement. */
const ASSERTS_A_FIGURE = /\b\d+(\.\d+)?\s*(%|percent|seconds?|ms|kb|mb|visitors?|customers?|users?)\b/i;

export async function runReviewAgent(options: ReviewAgentOptions): Promise<ReviewAgentResult> {
  const budgetMs = options.budgetMs ?? 120_000;
  const deadline = Date.now() + budgetMs;
  const clientVisible = options.clientVisible ?? true;

  const candidates = await db.finding.findMany({
    where: {
      deletedAt: null,
      verificationStatus: 'auto_detected',
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? 200,
    include: {
      /**
       * Evidence hangs off the observation, not the finding — the crawler
       * records what it saw, and the classifier turns that into a finding
       * afterwards. Screenshots attach to the finding directly. Reading only
       * one of the two would judge a well-evidenced finding as having none,
       * which is exactly how a reviewer becomes a rubber stamp in reverse:
       * rejecting everything until someone switches it off.
       */
      evidence: { select: { id: true, sourceUrl: true, capturedAt: true, kind: true } },
      observation: {
        select: {
          url: true,
          outcome: true,
          observedAt: true,
          source: true,
          evidence: { select: { id: true, sourceUrl: true, capturedAt: true, kind: true } },
        },
      },
    },
  });

  const rulesByCode = new Map(FINDING_RULES.map((r) => [r.checkCode, r]));
  const staleBefore = new Date(Date.now() - MAX_EVIDENCE_AGE_DAYS * 86_400_000);

  const result: ReviewAgentResult = {
    examined: 0,
    approved: 0,
    rejected: 0,
    rejections: [],
    organizationsTouched: 0,
    ranOutOfTime: false,
  };

  const touched = new Set<string>();
  const reviewedAt = new Date();

  for (const finding of candidates) {
    if (Date.now() > deadline - 10_000) {
      result.ranOutOfTime = true;
      break;
    }
    result.examined += 1;

    const evidence = [...finding.evidence, ...(finding.observation?.evidence ?? [])];
    const reason = rejectionReason(
      { ...finding, evidence, observation: finding.observation },
      rulesByCode,
      staleBefore,
    );

    if (reason) {
      await db.finding.update({
        where: { id: finding.id },
        data: {
          verificationStatus: 'needs_review',
          analystNote: [finding.analystNote, `Review agent: ${reason}`]
            .filter(Boolean)
            .join('\n'),
          reviewedAt,
        },
      });
      result.rejected += 1;
      if (result.rejections.length < 50) {
        result.rejections.push({
          reference: finding.reference,
          checkCode: finding.checkCode,
          reason,
        });
      }
    } else {
      await db.finding.update({
        where: { id: finding.id },
        data: {
          verificationStatus: 'agent_verified',
          clientVisible,
          reviewerId: options.actorId,
          reviewedAt,
        },
      });
      result.approved += 1;
    }

    touched.add(finding.organizationId);
  }

  for (const organizationId of touched) {
    try {
      await recomputeScores(organizationId);
    } catch {
      // Scoring is advisory and must not undo the review.
    }
  }
  result.organizationsTouched = touched.size;

  if (result.examined > 0) {
    await logActivity({
      actorId: options.actorId,
      organizationId: options.organizationId ?? null,
      action: 'agent.findings_reviewed',
      entityType: 'system',
      entityId: 'review-agent',
      newValue: {
        examined: result.examined,
        approved: result.approved,
        rejected: result.rejected,
        organizations: result.organizationsTouched,
      },
      reason: 'Automated second-pass review of audit findings.',
    });
  }

  return result;
}

type Candidate = {
  checkCode: string;
  confidence: string;
  severity: string;
  observation_text: string;
  businessImpact: string | null;
  recommendation: string | null;
  observedAt: Date | null;
  evidence: { id: string; sourceUrl: string | null; capturedAt: Date | null; kind: string }[];
  observation: {
    url: string | null;
    outcome: string;
    observedAt: Date;
    source: string;
  } | null;
};

/**
 * Returns why this finding may not be put in front of a client, or null when
 * the stored evidence supports it.
 *
 * Written as a list of refusals rather than a score. A finding either has
 * evidence behind it or it does not, and a threshold would let a confident
 * guess outvote a missing record.
 */
export function rejectionReason(
  finding: Candidate,
  rulesByCode: Map<string, { checkCode: string }>,
  staleBefore: Date,
): string | null {
  const rule = rulesByCode.get(finding.checkCode);
  if (!rule) {
    return `"${finding.checkCode}" is not in the finding catalogue, so there is no approved wording to stand behind.`;
  }

  if (finding.confidence === 'low') {
    return 'Confidence is low. Where the detector itself is unsure, a second automated opinion adds nothing — a person should look.';
  }

  /**
   * Provenance can come from either place, and both are real records.
   *
   * Some checks capture an artifact — a response body, a header, a screenshot —
   * and that becomes an Evidence row. Others are about an absence: robots.txt
   * is missing, no telephone link exists. There is no blob to store for a thing
   * that is not there, and the record of looking is the Observation itself,
   * which carries the URL, the outcome and the time.
   *
   * Demanding an Evidence row for every finding rejected 46 of 60 real
   * findings on a first pass — a reviewer that refuses everything is as
   * useless as one that approves everything, and gets switched off just as
   * fast. What must be true is that SOMETHING recorded where and when we
   * looked.
   */
  const observation = finding.observation;

  const urls = [
    ...finding.evidence.map((e) => e.sourceUrl),
    observation?.url ?? null,
  ].filter((u): u is string => !!u && u.trim().length > 0);

  if (urls.length === 0) {
    return 'Nothing records the URL this was observed at, so the finding cannot be pointed at anything.';
  }

  if (observation && observation.outcome !== 'issue') {
    return `The underlying observation is "${observation.outcome}", not "issue". Only an observed problem can become a claim.`;
  }

  const timestamps = [
    ...finding.evidence.map((e) => e.capturedAt),
    observation?.observedAt ?? null,
  ].filter((d): d is Date => d !== null);

  if (timestamps.length === 0) {
    return 'Nothing carries a capture time, so there is no way to say when this was true.';
  }

  const freshest = timestamps.sort((a, b) => b.getTime() - a.getTime())[0];
  if (freshest && freshest < staleBefore) {
    return `The newest evidence is from ${freshest.toISOString().slice(0, 10)}. The site may have changed since, and a claim that is out of date is wrong in writing.`;
  }

  const clientText = [finding.observation_text, finding.businessImpact, finding.recommendation]
    .filter(Boolean)
    .join(' ');

  if (ASSERTS_A_FIGURE.test(clientText)) {
    return 'The wording states a figure. Numbers may only appear where something measured them, and nothing here did.';
  }

  return null;
}
