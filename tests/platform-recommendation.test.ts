import { describe, expect, it } from 'vitest';
import {
  recommendAiServices,
  recommendPlatform,
  type RecommendationFinding,
} from '../src/server/proposals/platform-recommendation';

/**
 * The platform recommendation decides whether to propose a rebuild.
 *
 * The failure mode worth guarding against is not "misses a sale" — it is
 * recommending a rebuild the evidence does not support. That costs a client
 * real money for nothing, and it is the same category of error as inventing a
 * finding. So most of these tests are about the engine declining.
 */

let n = 0;
const finding = (checkCode: string, over: Partial<RecommendationFinding> = {}): RecommendationFinding => ({
  id: `id-${n}`,
  reference: `BTS-F-${String(++n).padStart(6, '0')}`,
  checkCode,
  category: over.category ?? 'cms',
  severity: over.severity ?? 'medium',
  confidence: over.confidence ?? 'high',
  observation: over.observation ?? `observed ${checkCode}`,
  ...over,
});

describe('rebuild — only when the platform itself is the problem', () => {
  it('recommends a rebuild when the CMS is unmanaged AND enquiries are not captured', () => {
    const result = recommendPlatform([
      finding('wp.default_pages'),
      finding('wp.readme'),
      finding('content.demo'),
      finding('form.present', { category: 'conversion' }),
      finding('whatsapp.link', { category: 'conversion' }),
      finding('analytics.tag_present', { category: 'conversion' }),
    ]);

    expect(result.verdict).toBe('rebuild');
    expect(result.serviceCodes).toContain('custom_platform_build');
    expect(result.serviceCodes).toContain('platform_migration');
    expect(result.serviceCodes).toContain('custom_crm');
    expect(result.serviceCodes).toContain('web_management_tool');
    // The case must cite the findings that produced it.
    expect(result.rationale.every((r) => r.point.length > 0)).toBe(true);
    expect(result.rationale.flatMap((r) => r.findingRefs).length).toBeGreaterThan(0);
  });

  it('offers the smaller option even when recommending the larger one', () => {
    const result = recommendPlatform([
      finding('wp.default_pages'),
      finding('content.lorem'),
      finding('form.present', { category: 'conversion' }),
      finding('contact.phone_visible', { category: 'conversion' }),
    ]);
    expect(result.verdict).toBe('rebuild');
    expect(result.honestCaveat).toMatch(/existing platform|rather than sell/i);
  });
});

describe('refusing to recommend a rebuild', () => {
  it('does not recommend a rebuild for CMS residue alone', () => {
    // Template content left behind is a content problem, not a platform problem.
    const result = recommendPlatform([
      finding('wp.default_pages'),
      finding('wp.hello_world'),
      finding('content.demo'),
    ]);
    expect(result.verdict).toBe('modernise');
    expect(result.serviceCodes).not.toContain('custom_platform_build');
    expect(result.honestCaveat).toMatch(/not recommending a rebuild/i);
  });

  it('does not recommend a rebuild for conversion gaps alone', () => {
    const result = recommendPlatform([
      finding('form.present', { category: 'conversion' }),
      finding('whatsapp.link', { category: 'conversion' }),
      finding('tel.link', { category: 'conversion' }),
    ]);
    expect(result.verdict).not.toBe('rebuild');
    expect(result.serviceCodes).not.toContain('custom_platform_build');
  });

  it('leaves a sound site alone and says so plainly', () => {
    const result = recommendPlatform([
      finding('image.lazy_missing', { category: 'performance', severity: 'low' }),
      finding('a11y.img_alt', { category: 'accessibility', severity: 'low' }),
    ]);
    expect(result.verdict).toBe('maintain');
    expect(result.serviceCodes).not.toContain('custom_platform_build');
    expect(result.honestCaveat).toMatch(/disservice/i);
  });
});

describe('no usable site', () => {
  it('treats a holding page as a first build, not a migration', () => {
    const result = recommendPlatform([
      finding('page.holding', { category: 'availability', severity: 'critical' }),
    ]);
    expect(result.verdict).toBe('first_build');
    expect(result.serviceCodes).toContain('custom_platform_build');
    expect(result.honestCaveat).toMatch(/re-check/i);
  });

  it('handles a business with no website at all', () => {
    const result = recommendPlatform([finding('gbp.no_website', { category: 'local' })], {
      hasWebsite: false,
    });
    expect(result.verdict).toBe('first_build');
    expect(result.rationale[0]!.point).toMatch(/no website on record/i);
  });
});

describe('AI services', () => {
  it('suggests an assistant only where contact paths are actually missing', () => {
    const withGaps = recommendAiServices([
      finding('whatsapp.link', { category: 'conversion' }),
      finding('form.present', { category: 'conversion' }),
    ]);
    expect(withGaps.map((a) => a.serviceCode)).toContain('ai_assistant');

    const withoutGaps = recommendAiServices([
      finding('image.lazy_missing', { category: 'performance' }),
    ]);
    expect(withoutGaps.map((a) => a.serviceCode)).not.toContain('ai_assistant');
  });

  it('does not suggest AI reporting until measurement is missing', () => {
    expect(
      recommendAiServices([finding('analytics.tag_present', { category: 'conversion' })]).map(
        (a) => a.serviceCode,
      ),
    ).toContain('ai_reporting');

    expect(
      recommendAiServices([finding('terms.page', { category: 'trust' })]).map((a) => a.serviceCode),
    ).not.toContain('ai_reporting');
  });

  it('suggests nothing when the audit shows no gap AI would address', () => {
    expect(recommendAiServices([finding('copyright.stale', { category: 'content' })])).toEqual([]);
  });

  it('never promises an outcome', () => {
    const all = recommendAiServices([
      finding('whatsapp.link', { category: 'conversion' }),
      finding('form.present', { category: 'conversion' }),
      finding('analytics.tag_present', { category: 'conversion' }),
      finding('page.thin', { category: 'content' }),
      finding('services.missing', { category: 'content' }),
      finding('gbp.no_hours', { category: 'local' }),
      finding('gbp.few_photos', { category: 'local' }),
    ]);
    expect(all.length).toBeGreaterThan(0);
    for (const opportunity of all) {
      expect(opportunity.justification).not.toMatch(
        /guarantee|will increase|will double|proven to|ensures more/i,
      );
      // Every suggestion must point at evidence.
      expect(opportunity.findingRefs.length).toBeGreaterThan(0);
    }
  });
});
