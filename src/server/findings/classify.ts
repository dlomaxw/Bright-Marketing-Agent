import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { ruleFor } from './rules';
import type { ObservationDraft } from '@/audit/types';

/**
 * Turns observations into findings.
 *
 * Three hard rules, all enforced here:
 *   1. Only `outcome === 'issue'` may become a finding.
 *      `unverifiable` and `skipped` NEVER do - that is what makes
 *      "Unable to verify automatically" honest rather than decorative.
 *   2. Only check codes present in the finding catalogue may become a finding.
 *      An unmapped issue is recorded as an observation and surfaced for review,
 *      but it is never given client-facing wording it does not have.
 *   3. Every finding is created with `verificationStatus: 'auto_detected'` and
 *      `clientVisible: false`. A human must promote it.
 */

export interface ClassifyInput {
  organizationId: string;
  auditRunId: string;
  observations: {
    id: string;
    checkCode: string;
    outcome: string;
    url: string | null;
    detail: string | null;
    observedAt: Date;
  }[];
}

const REFERENCE_PREFIX = 'BTS-F-';

/**
 * Human-facing finding references are sequential, so they can be quoted in a
 * report and looked up later.
 *
 * The next number is derived from the highest reference actually in the table
 * rather than from a cached counter: a cached counter drifts as soon as rows are
 * deleted or a second process writes, and a collision here silently loses a
 * finding. Callers pair this with the retry in `createWithReference`.
 */
async function nextReferenceNumber(): Promise<number> {
  const highest = await db.finding.findFirst({
    where: { reference: { startsWith: REFERENCE_PREFIX } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });
  const current = highest ? Number(highest.reference.slice(REFERENCE_PREFIX.length)) : 0;
  return Number.isFinite(current) ? current + 1 : 1;
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';

/**
 * Creates a finding, retrying on a reference collision. A collision is expected
 * under concurrency; losing the finding is not.
 */
async function createWithReference(
  data: Omit<Prisma.FindingUncheckedCreateInput, 'reference'>,
  attempts = 5,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const reference = `${REFERENCE_PREFIX}${String(await nextReferenceNumber()).padStart(6, '0')}`;
    try {
      await db.finding.create({ data: { ...data, reference } });
      return;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === attempts - 1) throw err;
      // Another writer took this number. Re-read and try the next one.
    }
  }
}

export interface ClassifyResult {
  created: number;
  updated: number;
  unmapped: string[];
}

export async function classifyObservations(input: ClassifyInput): Promise<ClassifyResult> {
  const result: ClassifyResult = { created: 0, updated: 0, unmapped: [] };

  for (const observation of input.observations) {
    if (observation.outcome !== 'issue') continue;

    const rule = ruleFor(observation.checkCode);
    if (!rule) {
      result.unmapped.push(observation.checkCode);
      continue;
    }

    // If this organization already has an open finding for the same check,
    // refresh it rather than accumulating duplicates across audit runs.
    const existing = await db.finding.findFirst({
      where: {
        organizationId: input.organizationId,
        checkCode: observation.checkCode,
        deletedAt: null,
        verificationStatus: { notIn: ['dismissed'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    const observationText = observation.detail ?? rule.title;

    if (existing) {
      // A previously fixed finding that reappears returns to review.
      const nextStatus =
        existing.verificationStatus === 'fixed' || existing.verificationStatus === 'outdated'
          ? 'needs_review'
          : existing.verificationStatus;

      await db.finding.update({
        where: { id: existing.id },
        data: {
          auditRunId: input.auditRunId,
          observationId: observation.id,
          observation_text: observationText,
          evidenceUrl: observation.url,
          observedAt: observation.observedAt,
          verificationStatus: nextStatus,
          requiresReverification: false,
          // A re-detected finding must be re-approved before it is shown again.
          clientVisible: nextStatus === 'manually_verified' ? existing.clientVisible : false,
        },
      });
      result.updated += 1;
      continue;
    }

    await createWithReference({
      organizationId: input.organizationId,
      auditRunId: input.auditRunId,
      observationId: observation.id,
      checkCode: rule.checkCode,
      category: rule.category,
      severity: rule.severity,
      confidence: rule.confidence,
      observation_text: observationText,
      businessImpact: rule.impact,
      recommendation: rule.recommendation,
      recommendedServiceCodes: JSON.stringify(rule.services),
      evidenceUrl: observation.url,
      observedAt: observation.observedAt,
      verificationStatus: rule.requiresManualCheck ? 'needs_review' : 'auto_detected',
      clientVisible: false,
      source: 'automated',
    });
    result.created += 1;
  }

  return result;
}

/**
 * Findings whose check now passes are marked `fixed` rather than deleted, so the
 * history of what was observed and when remains intact.
 */
export async function markResolvedFindings(
  organizationId: string,
  observations: ObservationDraft[],
): Promise<number> {
  const passing = observations
    .filter((o) => o.outcome === 'pass')
    .map((o) => o.checkCode);
  if (passing.length === 0) return 0;

  const { count } = await db.finding.updateMany({
    where: {
      organizationId,
      checkCode: { in: passing },
      deletedAt: null,
      verificationStatus: { in: ['auto_detected', 'needs_review', 'manually_verified'] },
    },
    data: { verificationStatus: 'fixed', clientVisible: false },
  });
  return count;
}


/**
 * Creates findings from checks performed outside the website crawler — today,
 * observations of a public Google Business listing.
 *
 * It goes through the same catalogue and the same defaults as the crawler:
 * an unmapped check code produces nothing, and every finding starts
 * `auto_detected` and not client-visible. A different source of evidence does
 * not mean a different standard of evidence.
 */
export async function createFindingsFromChecks(input: {
  organizationId: string;
  checks: { checkCode: string; detail: string; url: string | null; observedAt: Date }[];
  source?: 'automated' | 'manual' | 'imported';
  note?: string;
}): Promise<ClassifyResult> {
  const result: ClassifyResult = { created: 0, updated: 0, unmapped: [] };

  for (const check of input.checks) {
    const rule = ruleFor(check.checkCode);
    if (!rule) {
      result.unmapped.push(check.checkCode);
      continue;
    }

    const existing = await db.finding.findFirst({
      where: {
        organizationId: input.organizationId,
        checkCode: check.checkCode,
        deletedAt: null,
        verificationStatus: { notIn: ['dismissed'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await db.finding.update({
        where: { id: existing.id },
        data: {
          observation_text: check.detail,
          evidenceUrl: check.url,
          observedAt: check.observedAt,
          requiresReverification: false,
        },
      });
      result.updated += 1;
      continue;
    }

    await createWithReference({
      organizationId: input.organizationId,
      checkCode: rule.checkCode,
      category: rule.category,
      severity: rule.severity,
      confidence: rule.confidence,
      observation_text: check.detail,
      businessImpact: rule.impact,
      recommendation: rule.recommendation,
      recommendedServiceCodes: JSON.stringify(rule.services),
      evidenceUrl: check.url,
      observedAt: check.observedAt,
      verificationStatus: rule.requiresManualCheck ? 'needs_review' : 'auto_detected',
      clientVisible: false,
      source: input.source ?? 'automated',
      analystNote: input.note ?? null,
    });
    result.created += 1;
  }

  return result;
}
