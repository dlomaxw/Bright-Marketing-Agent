import {
  CONFIDENCE_WEIGHT,
  SEVERITY_WEIGHT,
  SENSITIVE_SECTORS,
  type Confidence,
  type Severity,
  type Sector,
} from '@/lib/enums';
import type { ScoringWeights } from '@/server/settings';

/**
 * Three separate scores, deliberately not blended (documentation section 6):
 *
 *   Opportunity  - commercial ranking
 *   Confidence   - how reliable the evidence behind that ranking is
 *   Relationship risk - how carefully this prospect must be approached
 *
 * A high opportunity score must never hide weak evidence, so `confidence` is
 * reported alongside it and never folded into it.
 *
 * Every component returns its own inputs so the UI can show the arithmetic.
 * This module is pure: no database, no clock, no I/O. See tests/scoring.test.ts.
 */

export interface ScorableFinding {
  category: string;
  severity: Severity;
  confidence: Confidence;
  verificationStatus: string;
  checkCode: string;
  recommendedServiceCodes: string[];
}

export interface ScorableOrganization {
  industry: string | null;
  sector: Sector | string;
  opportunityValue: number | null;
  website: string | null;
  employeesHint?: number | null;
}

export interface ScorableContact {
  verificationStatus: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  optedOut: boolean;
}

export interface ComponentScore {
  score: number;
  explanation: string;
  inputs: { label: string; value: string | number }[];
}

export interface ScoreResult {
  opportunity: number;
  confidence: number;
  relationshipRisk: number;
  weights: ScoringWeights;
  components: {
    urgency: ComponentScore;
    impact: ComponentScore;
    solutionFit: ComponentScore;
    organizationValue: ComponentScore;
    contactability: ComponentScore;
  };
  confidenceDetail: ComponentScore;
  riskDetail: ComponentScore;
  countedFindings: number;
  ignoredFindings: number;
  computedAt: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Only verified findings drive the commercial score. Auto-detected findings
 * are shown in the UI but must not inflate a lead before a human has looked.
 */
const isCounted = (f: ScorableFinding) => f.verificationStatus === 'manually_verified';

/** Checks that indicate the prospect is losing business right now. */
const URGENT_CHECKS = new Set([
  'http.status',
  'http.reachable',
  'dns.resolves',
  'dir.index',
  'page.holding',
  'page.parked',
  'tls.certificate',
  'https.available',
  'redirect.loop',
  'staging.public',
  'form.action_valid',
]);

/** Categories that most directly affect trust, discovery and lead capture. */
const IMPACT_WEIGHT: Record<string, number> = {
  availability: 1.0,
  conversion: 0.95,
  trust: 0.85,
  cms: 0.8,
  seo: 0.75,
  local: 0.7,
  content: 0.65,
  performance: 0.6,
  mobile: 0.55,
  accessibility: 0.55,
  social: 0.5,
};

function urgencyScore(findings: ScorableFinding[]): ComponentScore {
  const counted = findings.filter(isCounted);
  if (counted.length === 0) {
    return {
      score: 0,
      explanation: 'No verified findings yet, so urgency cannot be established.',
      inputs: [{ label: 'Verified findings', value: 0 }],
    };
  }
  // Driven by the worst verified finding, with a smaller contribution from volume,
  // so one critical issue outranks a long list of minor ones.
  const worst = Math.max(...counted.map((f) => SEVERITY_WEIGHT[f.severity]));
  const urgentCount = counted.filter((f) => URGENT_CHECKS.has(f.checkCode)).length;
  const volume = Math.min(counted.length, 8) / 8; // 0..1

  const score = clamp(worst * 0.7 + urgentCount * 8 + volume * 15);
  return {
    score,
    explanation:
      'Highest verified severity (70%), plus time-critical checks and the number of verified issues.',
    inputs: [
      { label: 'Highest verified severity', value: worst },
      { label: 'Time-critical findings', value: urgentCount },
      { label: 'Verified findings', value: counted.length },
    ],
  };
}

function impactScore(findings: ScorableFinding[]): ComponentScore {
  const counted = findings.filter(isCounted);
  if (counted.length === 0) {
    return {
      score: 0,
      explanation: 'No verified findings yet.',
      inputs: [{ label: 'Verified findings', value: 0 }],
    };
  }
  const perCategory = new Map<string, number>();
  for (const f of counted) {
    const w = IMPACT_WEIGHT[f.category] ?? 0.5;
    const value = SEVERITY_WEIGHT[f.severity] * w;
    perCategory.set(f.category, Math.max(perCategory.get(f.category) ?? 0, value));
  }
  const values = [...perCategory.values()].sort((a, b) => b - a);
  // Top three affected areas, with diminishing weight.
  const score = clamp(
    (values[0] ?? 0) * 0.6 + (values[1] ?? 0) * 0.28 + (values[2] ?? 0) * 0.12,
  );
  return {
    score,
    explanation:
      'Weighted by how directly each affected area influences trust, discovery and lead capture.',
    inputs: [
      { label: 'Affected areas', value: perCategory.size },
      ...[...perCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat, v]) => ({ label: `Area: ${cat}`, value: Math.round(v) })),
    ],
  };
}

function solutionFitScore(findings: ScorableFinding[]): ComponentScore {
  const counted = findings.filter(isCounted);
  const withService = counted.filter((f) => f.recommendedServiceCodes.length > 0);
  const distinctServices = new Set(counted.flatMap((f) => f.recommendedServiceCodes));

  if (counted.length === 0) {
    return {
      score: 0,
      explanation: 'No verified findings to match against the service catalogue.',
      inputs: [{ label: 'Verified findings', value: 0 }],
    };
  }
  const coverage = withService.length / counted.length; // 0..1
  const breadth = Math.min(distinctServices.size, 5) / 5; // 0..1
  const score = clamp(coverage * 70 + breadth * 30);
  return {
    score,
    explanation:
      'How many verified findings map to a Bright Thoughts service, and how much of the catalogue applies.',
    inputs: [
      { label: 'Findings with a matched service', value: `${withService.length}/${counted.length}` },
      { label: 'Distinct services applicable', value: distinctServices.size },
    ],
  };
}

/**
 * Deliberately conservative: without an entered deal value we do not guess a
 * company's worth, we award a neutral mid score and say so.
 */
function organizationValueScore(org: ScorableOrganization): ComponentScore {
  const inputs: { label: string; value: string | number }[] = [];
  let score = 50;
  let explanation = 'Neutral baseline - no opportunity value entered yet.';

  if (org.opportunityValue && org.opportunityValue > 0) {
    // Log scale so a single large number cannot dominate the ranking.
    const v = org.opportunityValue;
    const normalized = Math.log10(Math.max(v, 1)) / 8; // 100M -> 1.0
    score = clamp(normalized * 100);
    explanation = 'Derived from the opportunity value entered by the lead owner (log scale).';
    inputs.push({ label: 'Opportunity value', value: v });
  }
  if (org.industry) inputs.push({ label: 'Industry', value: org.industry });
  if (!org.website) {
    score = Math.max(score, 55);
    inputs.push({ label: 'No website on record', value: 'potential full build' });
  }
  return { score, explanation, inputs };
}

function contactabilityScore(contacts: ScorableContact[]): ComponentScore {
  const usable = contacts.filter((c) => !c.optedOut);
  if (usable.length === 0) {
    return {
      score: 0,
      explanation: contacts.length
        ? 'All known contacts have opted out - no outreach is possible.'
        : 'No contacts on record.',
      inputs: [{ label: 'Contacts', value: contacts.length }],
    };
  }
  const verified = usable.filter((c) => c.verificationStatus === 'verified');
  const withEmail = usable.filter((c) => !!c.email);
  const decisionMaker = usable.filter((c) =>
    /(director|owner|founder|ceo|manager|head|principal|proprietor|partner)/i.test(c.role ?? ''),
  );

  let score = 20;
  if (withEmail.length > 0) score += 30;
  if (verified.length > 0) score += 30;
  if (decisionMaker.length > 0) score += 20;

  return {
    score: clamp(score),
    explanation:
      'A verified decision-maker with an email address scores highest; unverified contacts score lower.',
    inputs: [
      { label: 'Contactable', value: usable.length },
      { label: 'Verified', value: verified.length },
      { label: 'With email', value: withEmail.length },
      { label: 'Decision-makers', value: decisionMaker.length },
    ],
  };
}

/** Evidence Confidence Score - reported separately, never folded into opportunity. */
function confidenceScore(findings: ScorableFinding[]): ComponentScore {
  const counted = findings.filter(isCounted);
  if (counted.length === 0) {
    return {
      score: 0,
      explanation: 'No verified findings, so there is no evidence to be confident about.',
      inputs: [{ label: 'Verified findings', value: 0 }],
    };
  }
  const avg =
    counted.reduce((sum, f) => sum + CONFIDENCE_WEIGHT[f.confidence], 0) / counted.length;
  const verifiedShare = counted.length / Math.max(findings.length, 1);

  const byLevel = { high: 0, medium: 0, low: 0 };
  for (const f of counted) byLevel[f.confidence] += 1;

  return {
    score: clamp(avg * 0.75 + verifiedShare * 25),
    explanation:
      'Average confidence of verified findings, adjusted by how much of the finding set has been reviewed.',
    inputs: [
      { label: 'High confidence', value: byLevel.high },
      { label: 'Medium confidence', value: byLevel.medium },
      { label: 'Low confidence', value: byLevel.low },
      { label: 'Reviewed share', value: `${Math.round(verifiedShare * 100)}%` },
    ],
  };
}

/**
 * Relationship Risk Score - how much care outreach needs. Higher means riskier.
 * Sensitive sectors, unverified contacts and stale or low-confidence evidence
 * all raise it.
 */
function relationshipRiskScore(
  org: ScorableOrganization,
  findings: ScorableFinding[],
  contacts: ScorableContact[],
  staleCount: number,
): ComponentScore {
  const inputs: { label: string; value: string | number }[] = [];
  let score = 10;

  if (SENSITIVE_SECTORS.includes(org.sector as Sector)) {
    score += 40;
    inputs.push({ label: 'Sensitive sector', value: org.sector });
  }
  const counted = findings.filter(isCounted);
  const lowConfidence = counted.filter((f) => f.confidence === 'low').length;
  if (lowConfidence > 0) {
    score += Math.min(lowConfidence * 8, 20);
    inputs.push({ label: 'Low-confidence verified findings', value: lowConfidence });
  }
  if (staleCount > 0) {
    score += Math.min(staleCount * 6, 20);
    inputs.push({ label: 'Stale findings', value: staleCount });
  }
  const unverifiedOnly =
    contacts.length > 0 && contacts.every((c) => c.verificationStatus !== 'verified');
  if (unverifiedOnly) {
    score += 15;
    inputs.push({ label: 'No verified contact', value: 'yes' });
  }
  if (contacts.some((c) => c.optedOut)) {
    score += 15;
    inputs.push({ label: 'Opted-out contact on record', value: 'yes' });
  }
  if (inputs.length === 0) inputs.push({ label: 'No elevated risk factors', value: 'baseline' });

  return {
    score: clamp(score),
    explanation:
      'Raised by sensitive sectors, weak or stale evidence, unverified contacts and prior opt-outs.',
    inputs,
  };
}

export function computeScores(args: {
  organization: ScorableOrganization;
  findings: ScorableFinding[];
  contacts: ScorableContact[];
  weights: ScoringWeights;
  staleFindingCount?: number;
  now?: Date;
}): ScoreResult {
  const { organization, findings, contacts, weights } = args;

  const components = {
    urgency: urgencyScore(findings),
    impact: impactScore(findings),
    solutionFit: solutionFitScore(findings),
    organizationValue: organizationValueScore(organization),
    contactability: contactabilityScore(contacts),
  };

  const opportunity = clamp(
    components.urgency.score * weights.urgency +
      components.impact.score * weights.impact +
      components.solutionFit.score * weights.solutionFit +
      components.organizationValue.score * weights.organizationValue +
      components.contactability.score * weights.contactability,
  );

  const confidenceDetail = confidenceScore(findings);
  const riskDetail = relationshipRiskScore(
    organization,
    findings,
    contacts,
    args.staleFindingCount ?? 0,
  );
  const counted = findings.filter(isCounted).length;

  return {
    opportunity,
    confidence: confidenceDetail.score,
    relationshipRisk: riskDetail.score,
    weights,
    components,
    confidenceDetail,
    riskDetail,
    countedFindings: counted,
    ignoredFindings: findings.length - counted,
    computedAt: (args.now ?? new Date()).toISOString(),
  };
}
