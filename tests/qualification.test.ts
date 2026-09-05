import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  qualifyBusiness,
  type BusinessProfileSignals,
} from '../src/server/leads/qualification';

/**
 * The qualification gate decides who the agency spends time on. Getting it
 * wrong in either direction is costly: pitching a dead listing wastes effort and
 * looks indiscriminate, and rejecting a good prospect loses work. So the
 * boundaries are pinned down here.
 */

const established: BusinessProfileSignals = {
  name: 'Kampala Dental Centre',
  businessStatus: 'OPERATIONAL',
  websiteUri: null,
  nationalPhoneNumber: '+256 414 000 000',
  formattedAddress: 'Plot 12, Kampala Road, Kampala',
  rating: 4.4,
  userRatingCount: 86,
  photoCount: 12,
  hasOpeningHours: true,
  hasDescription: false,
  types: ['dentist', 'health', 'point_of_interest'],
  googleMapsUri: 'https://maps.google.com/?cid=123',
};

describe('qualified prospects', () => {
  it('accepts an established business with no website', () => {
    const result = qualifyBusiness(established);
    expect(result.verdict).toBe('qualified');
    expect(result.blockers).toEqual([]);
    expect(result.establishedScore).toBeGreaterThanOrEqual(60);
    expect(result.needScore).toBeGreaterThanOrEqual(60);
    expect(result.opportunitySummary).toMatch(/without a website/i);
  });

  it('explains itself with the numbers it actually saw', () => {
    const result = qualifyBusiness(established);
    expect(result.reasons.join(' ')).toContain('86 review');
    const reviews = result.establishedSignals.find((s) => s.key === 'reviews');
    expect(reviews?.observed).toBe('86 review(s)');
    expect(reviews?.outcome).toBe('pass');
  });

  it('treats a social page used as a website as a real opportunity', () => {
    const result = qualifyBusiness({
      ...established,
      websiteUri: 'https://www.facebook.com/kampaladental',
    });
    expect(result.verdict).toBe('qualified');
    expect(result.opportunitySummary).toMatch(/social page/i);
  });
});

describe('rejections — a business found is not a business worth pitching', () => {
  it('rejects a listing with too few reviews to be established', () => {
    const result = qualifyBusiness({ ...established, userRatingCount: 2 });
    expect(result.verdict).toBe('rejected');
    expect(result.blockers.join(' ')).toMatch(/Only 2 review/);
  });

  it('rejects a permanently closed business', () => {
    const result = qualifyBusiness({ ...established, businessStatus: 'CLOSED_PERMANENTLY' });
    expect(result.verdict).toBe('rejected');
    expect(result.blockers.join(' ')).toMatch(/permanently closed/i);
  });

  it('rejects a listing with no way to reach the business', () => {
    const result = qualifyBusiness({
      ...established,
      nationalPhoneNumber: null,
      internationalPhoneNumber: null,
      formattedAddress: null,
    });
    expect(result.verdict).toBe('rejected');
    expect(result.blockers.join(' ')).toMatch(/cannot be reached/i);
  });

  it('rejects a poorly rated business rather than selling it a website', () => {
    const result = qualifyBusiness({ ...established, rating: 1.9 });
    expect(result.verdict).toBe('rejected');
    expect(result.blockers.join(' ')).toMatch(/will not solve/i);
  });

  it('rejects a place that is not a business at all', () => {
    const result = qualifyBusiness({
      ...established,
      types: ['locality', 'political'],
    });
    expect(result.verdict).toBe('rejected');
    expect(result.blockers.join(' ')).toMatch(/place rather than a business/i);
  });
});

describe('businesses that already have a website', () => {
  it('does not treat a real website as a need, and says why', () => {
    const result = qualifyBusiness({
      ...established,
      websiteUri: 'https://kampaladental.co.ug',
      hasDescription: true,
      photoCount: 20,
    });
    expect(result.verdict).not.toBe('qualified');
    expect(result.needScore).toBeLessThan(60);
    expect(result.reasons.join(' ')).toMatch(/Audit it before assuming/i);
  });
});

describe('uncertain cases go to a human', () => {
  it('asks for manual review rather than guessing', () => {
    const result = qualifyBusiness({
      ...established,
      userRatingCount: 11, // just over the bar
      rating: null,
      photoCount: 0,
      hasOpeningHours: false,
      websiteUri: 'https://kampaladental.co.ug',
      hasDescription: true,
    });
    expect(result.verdict).toBe('needs_manual_review');
    expect(result.reasons.join(' ')).toMatch(/Confirm the business manually/i);
  });

  it('scores an unreadable profile low rather than well by omission', () => {
    const result = qualifyBusiness({
      name: 'Unknown Listing',
      businessStatus: 'OPERATIONAL',
      formattedAddress: 'Kampala',
      userRatingCount: 40,
      rating: null,
      photoCount: 0,
      hasOpeningHours: false,
      hasDescription: false,
      types: ['store'],
    });
    // Missing signals must not be read as passes.
    expect(result.establishedScore).toBeLessThan(90);
    const rating = result.establishedSignals.find((s) => s.key === 'rating');
    expect(rating?.outcome).toBe('unknown');
    expect(rating?.observed).toBe('not published');
  });
});

describe('thresholds are configurable', () => {
  it('honours a stricter review requirement', () => {
    const result = qualifyBusiness(established, [], {
      ...DEFAULT_THRESHOLDS,
      minReviews: 200,
    });
    expect(result.verdict).toBe('rejected');
    expect(result.blockers.join(' ')).toMatch(/below the 200 needed/);
  });
});
