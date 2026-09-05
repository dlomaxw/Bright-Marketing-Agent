import { describe, it, expect } from 'vitest';
import { validateModelOutput, BANNED_PATTERNS } from '../src/ai/contract';

describe('validateModelOutput', () => {
  const allowedFindingIds = ['f_101', 'f_102'];
  const supportingText = 'The website returned an HTTP 500 error code on 2026-09-01.';

  const validOutput = {
    summary: 'The audit observed a 500 error on the home page.',
    finding_ids_used: ['f_101'],
    client_safe_observations: [
      { finding_id: 'f_101', observation: 'We observed HTTP 500 on main URL.' },
    ],
    business_implications: [
      { finding_id: 'f_101', implication: 'Visitors cannot load the home page.' },
    ],
    recommendations: [
      {
        finding_ids: ['f_101'],
        recommendation: 'Fix server routing configuration.',
        priority: 'quick_win' as const,
      },
    ],
    excluded_findings: [],
    uncertainty_notes: [],
    needs_human_review: false,
  };

  it('passes for valid model output', () => {
    const res = validateModelOutput(validOutput, allowedFindingIds, supportingText);
    expect(res.ok).toBe(true);
    expect(res.issues).toHaveLength(0);
  });

  it('rejects unknown finding IDs', () => {
    const invalidOutput = {
      ...validOutput,
      finding_ids_used: ['f_999'],
    };
    const res = validateModelOutput(invalidOutput, allowedFindingIds, supportingText);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.code === 'unknown_finding_id')).toBe(true);
  });

  it('rejects banned security phrases', () => {
    const bannedOutput = {
      ...validOutput,
      summary: 'Your website has been hacked and is vulnerable.',
    };
    const res = validateModelOutput(bannedOutput, allowedFindingIds, supportingText);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.code === 'banned_phrase')).toBe(true);
  });

  it('rejects monetary amounts in output', () => {
    const commercialOutput = {
      ...validOutput,
      summary: 'Fixing this will cost USD 500.',
    };
    const res = validateModelOutput(commercialOutput, allowedFindingIds, supportingText);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.code === 'commercial_content')).toBe(true);
  });

  it('rejects unsupported numbers not found in supporting text', () => {
    const unquotedOutput = {
      ...validOutput,
      summary: 'You are losing 987654 visitors daily.',
    };
    const res = validateModelOutput(unquotedOutput, allowedFindingIds, supportingText);
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.code === 'unsupported_number')).toBe(true);
  });
});
