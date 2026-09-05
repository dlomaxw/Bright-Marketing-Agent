/**
 * Prospect qualification.
 *
 * The rule this module exists to enforce: **a business is not a prospect just
 * because it was found.** Before any research, report or proposal, it must show
 * evidence of being a real, established, trading business, and evidence of
 * actually needing the services being sold.
 *
 * Both halves matter, and they fail for different reasons:
 *
 *  - A business with no website but two reviews and no photos may be a
 *    one-person side venture or a dead listing. Pitching it wastes everyone's
 *    time and makes the agency look indiscriminate.
 *  - A well-established business that already has a good website does not need
 *    a website built. Pitching it is the same mistake in the other direction.
 *
 * This module is pure — no database, no network, no clock beyond what is passed
 * in — so the decision can be unit tested and, more importantly, *explained*.
 * Every verdict returns the signals that produced it.
 */

/** The subset of a Google Business Profile this decision depends on. */
export interface BusinessProfileSignals {
  name: string;
  /** Google's own operational state. */
  businessStatus?: string | null;
  websiteUri?: string | null;
  nationalPhoneNumber?: string | null;
  internationalPhoneNumber?: string | null;
  formattedAddress?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  photoCount?: number;
  hasOpeningHours?: boolean;
  hasDescription?: boolean;
  primaryType?: string | null;
  types?: string[];
  googleMapsUri?: string | null;
}

/** Public social profiles an analyst has confirmed, if any. */
export interface SocialSignals {
  platform: string;
  url: string;
  /** Only ever set from an authorised API or a human check. */
  followers?: number | null;
  lastPostAt?: Date | null;
}

export interface QualificationThresholds {
  /** Reviews needed before a listing counts as an established trading business. */
  minReviews: number;
  /** Below this, the business may have problems a website will not fix. */
  minRating: number;
  /** Photos on the profile suggest someone maintains it. */
  minPhotos: number;
  /** A profile older/quieter than this is treated as unproven. */
  requireContactDetail: boolean;
}

export const DEFAULT_THRESHOLDS: QualificationThresholds = {
  minReviews: 10,
  minRating: 3.0,
  minPhotos: 1,
  requireContactDetail: true,
};

export type QualificationVerdict = 'qualified' | 'needs_manual_review' | 'rejected';

export interface Signal {
  key: string;
  label: string;
  /** What was actually observed. Shown to the analyst verbatim. */
  observed: string;
  outcome: 'pass' | 'fail' | 'unknown';
}

export interface QualificationResult {
  verdict: QualificationVerdict;
  /** 0-100. Only meaningful when the verdict is not `rejected`. */
  establishedScore: number;
  /** 0-100. How clearly this business needs the services on offer. */
  needScore: number;
  establishedSignals: Signal[];
  needSignals: Signal[];
  /** Plain-language reasons, suitable for showing in the UI or telling a user. */
  reasons: string[];
  /** Why it was rejected, if it was. Empty otherwise. */
  blockers: string[];
  /** The opportunity in one line, when qualified. */
  opportunitySummary: string | null;
}

const signal = (
  key: string,
  label: string,
  observed: string,
  outcome: Signal['outcome'],
): Signal => ({ key, label, observed, outcome });

/**
 * Words in a Google place type that indicate the listing is not a business we
 * could build a website for — a bus stop, an administrative area, a road.
 */
const NON_BUSINESS_TYPES = new Set([
  'locality',
  'political',
  'route',
  'street_address',
  'postal_code',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'country',
  'bus_station',
  'transit_station',
  'natural_feature',
  'point_of_interest',
]);

export function qualifyBusiness(
  profile: BusinessProfileSignals,
  social: SocialSignals[] = [],
  thresholds: QualificationThresholds = DEFAULT_THRESHOLDS,
): QualificationResult {
  const establishedSignals: Signal[] = [];
  const needSignals: Signal[] = [];
  const reasons: string[] = [];
  const blockers: string[] = [];

  // ---- Hard rejections -----------------------------------------------------
  // These are not "low scores", they are reasons this is not a prospect at all.

  const status = (profile.businessStatus ?? '').toUpperCase();
  if (status && status !== 'OPERATIONAL') {
    blockers.push(
      status === 'CLOSED_PERMANENTLY'
        ? 'Google lists this business as permanently closed.'
        : status === 'CLOSED_TEMPORARILY'
          ? 'Google lists this business as temporarily closed.'
          : `Google reports the business status as ${status}.`,
    );
  }

  const types = profile.types ?? [];
  const meaningfulTypes = types.filter((t) => !NON_BUSINESS_TYPES.has(t));
  if (types.length > 0 && meaningfulTypes.length === 0) {
    blockers.push(
      `The listing is categorised only as ${types.join(', ')}, which is a place rather than a business.`,
    );
  }

  // ---- Is it established? --------------------------------------------------

  const reviews = profile.userRatingCount ?? 0;
  establishedSignals.push(
    signal(
      'reviews',
      'Customer reviews',
      profile.userRatingCount === null || profile.userRatingCount === undefined
        ? 'not published'
        : `${reviews} review(s)`,
      reviews >= thresholds.minReviews ? 'pass' : 'fail',
    ),
  );

  const rating = profile.rating ?? null;
  establishedSignals.push(
    signal(
      'rating',
      'Average rating',
      rating === null ? 'not published' : `${rating.toFixed(1)} out of 5`,
      rating === null ? 'unknown' : rating >= thresholds.minRating ? 'pass' : 'fail',
    ),
  );

  const hasPhone = !!(profile.nationalPhoneNumber || profile.internationalPhoneNumber);
  const hasAddress = !!profile.formattedAddress;
  establishedSignals.push(
    signal(
      'contactable',
      'Published contact details',
      [hasPhone ? 'telephone' : null, hasAddress ? 'address' : null].filter(Boolean).join(' and ') ||
        'none published',
      hasPhone || hasAddress ? 'pass' : 'fail',
    ),
  );

  const photos = profile.photoCount ?? 0;
  establishedSignals.push(
    signal(
      'photos',
      'Profile photos',
      `${photos} photo(s)`,
      photos >= thresholds.minPhotos ? 'pass' : 'fail',
    ),
  );

  establishedSignals.push(
    signal(
      'hours',
      'Opening hours published',
      profile.hasOpeningHours ? 'yes' : 'no',
      profile.hasOpeningHours ? 'pass' : 'fail',
    ),
  );

  if (social.length > 0) {
    const active = social.filter((s) => s.lastPostAt);
    establishedSignals.push(
      signal(
        'social_presence',
        'Public social profiles',
        `${social.length} profile(s) on ${[...new Set(social.map((s) => s.platform))].join(', ')}`,
        'pass',
      ),
    );
    if (active.length > 0) {
      const newest = active
        .map((s) => s.lastPostAt!)
        .sort((a, b) => b.getTime() - a.getTime())[0]!;
      establishedSignals.push(
        signal(
          'social_activity',
          'Most recent social activity',
          newest.toISOString().slice(0, 10),
          'pass',
        ),
      );
    }
  } else {
    establishedSignals.push(
      signal('social_presence', 'Public social profiles', 'none recorded', 'unknown'),
    );
  }

  // Reviews and contactability carry the most weight: they are the hardest
  // signals to fake and the best evidence that a business actually trades.
  const establishedScore = clamp(
    scoreOf(establishedSignals, {
      reviews: 40,
      rating: 10,
      contactable: 25,
      photos: 10,
      hours: 10,
      social_presence: 5,
    }),
  );

  if (reviews < thresholds.minReviews) {
    blockers.push(
      `Only ${reviews} review(s) on Google — below the ${thresholds.minReviews} needed to treat this as an established business. It may be new, dormant or a duplicate listing.`,
    );
  }
  if (thresholds.requireContactDetail && !hasPhone && !hasAddress) {
    blockers.push('No telephone number or address is published, so the business cannot be reached or confirmed.');
  }
  if (rating !== null && rating < thresholds.minRating) {
    blockers.push(
      `The average rating is ${rating.toFixed(1)}. A business rated this low may have problems that a website will not solve — review manually before approaching.`,
    );
  }

  // ---- Does it need what we sell? -----------------------------------------

  const website = (profile.websiteUri ?? '').trim();
  const hasWebsite = website.length > 0;

  // A Facebook or Instagram page used as the "website" is exactly the prospect
  // we want: they have an online presence but no site they control.
  const socialAsWebsite =
    hasWebsite && /facebook\.com|instagram\.com|linktr\.ee|wa\.me|business\.site/i.test(website);

  needSignals.push(
    signal(
      'website',
      'Website',
      !hasWebsite
        ? 'no website published on the Google listing'
        : socialAsWebsite
          ? `uses a social or link-in-bio page as its website (${website})`
          : website,
      !hasWebsite || socialAsWebsite ? 'pass' : 'fail',
    ),
  );

  needSignals.push(
    signal(
      'description',
      'Business description',
      profile.hasDescription ? 'published' : 'not published',
      profile.hasDescription ? 'fail' : 'pass',
    ),
  );

  needSignals.push(
    signal(
      'photo_depth',
      'Profile completeness',
      `${photos} photo(s)`,
      photos < 5 ? 'pass' : 'fail',
    ),
  );

  const needScore = clamp(
    scoreOf(needSignals, { website: 70, description: 15, photo_depth: 15 }),
  );

  if (hasWebsite && !socialAsWebsite) {
    // Not a blocker — the site may still be poor — but it changes the pitch
    // entirely, and it must be audited before anyone claims it needs work.
    reasons.push(
      `${profile.name} already publishes a website (${website}). Audit it before assuming there is an opportunity — the pitch would be improvement, not a first build.`,
    );
  }

  // ---- Verdict -------------------------------------------------------------

  let verdict: QualificationVerdict;
  if (blockers.length > 0) {
    verdict = 'rejected';
  } else if (establishedScore >= 60 && needScore >= 60) {
    verdict = 'qualified';
  } else {
    verdict = 'needs_manual_review';
  }

  if (verdict === 'qualified') {
    reasons.unshift(
      `${profile.name} shows ${reviews} review(s)${rating !== null ? ` at ${rating.toFixed(1)} stars` : ''}, ` +
        `publishes ${hasPhone ? 'a telephone number' : 'an address'}, and ` +
        `${!hasWebsite ? 'has no website' : 'relies on a social page instead of its own website'}.`,
    );
  } else if (verdict === 'needs_manual_review') {
    reasons.unshift(
      `${profile.name} is not clear-cut: established score ${establishedScore}, need score ${needScore}. ` +
        'Confirm the business manually before spending time on an audit.',
    );
  }

  const opportunitySummary =
    verdict === 'qualified'
      ? !hasWebsite
        ? 'Established business trading without a website — a first website build with enquiry capture and measurement.'
        : 'Established business relying on a social page instead of a site it controls — a website build plus conversion tracking.'
      : null;

  return {
    verdict,
    establishedScore,
    needScore,
    establishedSignals,
    needSignals,
    reasons,
    blockers,
    opportunitySummary,
  };
}

function scoreOf(signals: Signal[], weights: Record<string, number>): number {
  let earned = 0;
  let available = 0;
  for (const s of signals) {
    const weight = weights[s.key];
    if (weight === undefined) continue;
    available += weight;
    if (s.outcome === 'pass') earned += weight;
    // `unknown` earns nothing but still counts against the total, so a profile
    // we cannot read scores low rather than scoring well by omission.
  }
  return available === 0 ? 0 : (earned / available) * 100;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
