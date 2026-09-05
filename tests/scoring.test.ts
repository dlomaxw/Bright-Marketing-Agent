import { describe, it, expect } from 'vitest';
import { computeScores } from '../src/server/scoring';
import { DEFAULT_WEIGHTS } from '../src/server/settings';

describe('computeScores', () => {
  const baseOrg = {
    industry: 'Construction',
    sector: 'commercial',
    opportunityValue: 50000,
    website: 'https://example.com',
  };

  const baseWeights = DEFAULT_WEIGHTS;

  it('returns 0 for opportunity when there are no verified findings and no contacts', () => {
    const result = computeScores({
      organization: baseOrg,
      findings: [],
      contacts: [],
      weights: baseWeights,
    });

    expect(result.countedFindings).toBe(0);
    expect(result.ignoredFindings).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.components.urgency.score).toBe(0);
    expect(result.components.impact.score).toBe(0);
    expect(result.components.solutionFit.score).toBe(0);
    expect(result.components.contactability.score).toBe(0);
  });

  it('only counts manually_verified findings for commercial scoring', () => {
    const result = computeScores({
      organization: baseOrg,
      findings: [
        {
          category: 'availability',
          severity: 'critical',
          confidence: 'high',
          verificationStatus: 'auto_detected',
          checkCode: 'http.status',
          recommendedServiceCodes: ['web_rebuild'],
        },
        {
          category: 'availability',
          severity: 'critical',
          confidence: 'high',
          verificationStatus: 'manually_verified',
          checkCode: 'http.status',
          recommendedServiceCodes: ['web_rebuild'],
        },
      ],
      contacts: [
        {
          verificationStatus: 'verified',
          email: 'director@example.com',
          phone: '+256772000000',
          role: 'Managing Director',
          optedOut: false,
        },
      ],
      weights: baseWeights,
    });

    expect(result.countedFindings).toBe(1);
    expect(result.ignoredFindings).toBe(1);
    expect(result.components.urgency.score).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.components.contactability.score).toBe(100);
  });

  it('elevates relationship risk for sensitive sectors and opted-out contacts', () => {
    const sensitiveResult = computeScores({
      organization: { ...baseOrg, sector: 'finance' },
      findings: [],
      contacts: [
        {
          verificationStatus: 'unverified',
          email: 'info@example.com',
          phone: null,
          role: null,
          optedOut: true,
        },
      ],
      weights: baseWeights,
    });

    expect(sensitiveResult.relationshipRisk).toBeGreaterThanOrEqual(50);
  });
});
