import { db } from '@/lib/db';
import { parseStringArray } from '@/lib/json';
import type { Confidence, Sector, Severity } from '@/lib/enums';
import { getSetting } from '@/server/settings';
import { computeScores, type ScoreResult } from './index';

/**
 * Recomputes and persists all three scores for one organization, storing the
 * full component breakdown so the UI can show exactly how each number was
 * reached (documentation section 6: "Show how every score was calculated").
 */
export async function recomputeScores(organizationId: string): Promise<ScoreResult | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      findings: { where: { deletedAt: null } },
      contacts: { where: { deletedAt: null } },
    },
  });
  if (!org) return null;

  const weights = await getSetting('scoring.weights');
  const outreach = await getSetting('outreach.rules');
  const staleBefore = new Date(Date.now() - outreach.freshnessHours * 3600_000);

  const staleFindingCount = org.findings.filter(
    (f) => f.verificationStatus === 'manually_verified' && f.observedAt < staleBefore,
  ).length;

  const result = computeScores({
    organization: {
      industry: org.industry,
      sector: org.sector as Sector,
      opportunityValue: org.opportunityValue,
      website: org.website,
    },
    findings: org.findings.map((f) => ({
      category: f.category,
      severity: f.severity as Severity,
      confidence: f.confidence as Confidence,
      verificationStatus: f.verificationStatus,
      checkCode: f.checkCode,
      recommendedServiceCodes: parseStringArray(f.recommendedServiceCodes),
    })),
    contacts: org.contacts.map((c) => ({
      verificationStatus: c.verificationStatus,
      email: c.email,
      phone: c.phone,
      role: c.role,
      optedOut: c.optedOut,
    })),
    weights,
    staleFindingCount,
  });

  await db.organization.update({
    where: { id: organizationId },
    data: {
      opportunityScore: result.opportunity,
      confidenceScore: result.confidence,
      relationshipRisk: result.relationshipRisk,
      scoreBreakdownJson: JSON.stringify(result),
      scoredAt: new Date(),
    },
  });

  return result;
}

/** Bulk recompute, used after an administrator changes the scoring weights. */
export async function recomputeAll(): Promise<number> {
  const orgs = await db.organization.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });
  for (const org of orgs) await recomputeScores(org.id);
  return orgs.length;
}
