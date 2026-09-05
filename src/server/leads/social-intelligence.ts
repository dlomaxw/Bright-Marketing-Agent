import { env, integrations } from '@/lib/env';

/**
 * Deep review and audience analysis.
 *
 * What is actually obtainable, and what is not — because the difference decides
 * what this product may claim:
 *
 *   Google reviews  — REAL. The Places API returns the rating, the total review
 *                     count and a sample of review text. Analysed here.
 *   YouTube         — REAL. The Data API returns subscriber, video and view
 *                     counts for any public channel, with an API key.
 *   Facebook /      — NOT obtainable for a prospect. Meta's Graph API only
 *   Instagram         exposes follower counts and comments for pages the token
 *                     holder manages. A prospect is by definition not that.
 *   LinkedIn        — Same. Organization data needs an admin-granted token.
 *   TikTok          — Same.
 *
 * So this module does the real analysis where an API allows it, and returns an
 * explicit "requires manual review" for the rest. It does not scrape, and it
 * does not estimate a follower count it cannot read. A fabricated engagement
 * number in a client report is exactly the failure this product exists to
 * prevent — and it is the kind a client can disprove in one click.
 */

export interface ReviewSample {
  rating: number | null;
  text: string | null;
  publishedAt: string | null;
  relativeTime: string | null;
  author: string | null;
}

export interface ReviewIntelligence {
  available: boolean;
  source: 'google_places' | 'unavailable';
  rating: number | null;
  totalReviews: number | null;
  /** Up to five, which is all the API returns. */
  sample: ReviewSample[];
  /** Derived only from the sample, and labelled as such. */
  analysis: {
    sampleSize: number;
    sampleAverage: number | null;
    negativeInSample: number;
    mostRecentReviewAt: string | null;
    /** Words recurring across reviews — a hint, not a conclusion. */
    recurringTerms: { term: string; count: number }[];
  };
  observations: string[];
  caveat: string;
}

export interface AudienceIntelligence {
  platform: string;
  available: boolean;
  reason: string;
  metrics: Record<string, number | string | null>;
}

export interface ServiceVisibility {
  /** Can a visitor tell what this business sells, from its public profiles? */
  clear: boolean | null;
  sources: { source: string; statesServices: boolean | null; detail: string }[];
  observations: string[];
}

// ---------------------------------------------------------------------------
// Google reviews
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'was', 'were', 'with', 'this', 'that', 'they', 'them', 'have', 'has',
  'had', 'not', 'but', 'you', 'your', 'their', 'from', 'are', 'our', 'out', 'very', 'all',
  'been', 'when', 'what', 'who', 'will', 'would', 'there', 'here', 'get', 'got', 'can',
  'just', 'more', 'than', 'then', 'also', 'some', 'about', 'into', 'over', 'only', 'its',
  'his', 'her', 'she', 'him', 'because', 'after', 'before', 'now', 'one', 'two', 'their',
]);

/** Terms recurring across reviews. A hint for an analyst, never a conclusion. */
function recurringTerms(texts: string[]): { term: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    // Count each term once per review, so one effusive review cannot dominate.
    const seen = new Set<string>();
    for (const raw of text.toLowerCase().split(/[^a-z']+/)) {
      const word = raw.replace(/'/g, '');
      if (word.length < 4 || STOP_WORDS.has(word) || seen.has(word)) continue;
      seen.add(word);
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term, count]) => ({ term, count }));
}

interface PlaceDetailsResponse {
  rating?: number;
  userRatingCount?: number;
  reviews?: {
    rating?: number;
    text?: { text?: string };
    originalText?: { text?: string };
    publishTime?: string;
    relativePublishTimeDescription?: string;
    authorAttribution?: { displayName?: string };
  }[];
  editorialSummary?: { text?: string };
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  websiteUri?: string;
  displayName?: { text?: string };
}

const UNAVAILABLE_CAVEAT =
  'Google returns at most five reviews through its API, so anything derived from the text is a ' +
  'sample, not a summary of every review. The rating and total count are complete.';

export async function fetchReviewIntelligence(placeId: string): Promise<ReviewIntelligence> {
  const empty: ReviewIntelligence = {
    available: false,
    source: 'unavailable',
    rating: null,
    totalReviews: null,
    sample: [],
    analysis: {
      sampleSize: 0,
      sampleAverage: null,
      negativeInSample: 0,
      mostRecentReviewAt: null,
      recurringTerms: [],
    },
    observations: [],
    caveat:
      'Google Places is not configured, so reviews could not be read. Set GOOGLE_PLACES_API_KEY. ' +
      'No rating or review count has been assumed.',
  };

  if (!integrations.googlePlaces) return empty;

  let place: PlaceDetailsResponse;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask':
          'rating,userRatingCount,reviews,editorialSummary,primaryTypeDisplayName,types,websiteUri,displayName',
      },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      return { ...empty, caveat: `Google Places returned HTTP ${res.status}. Reviews were not read.` };
    }
    place = (await res.json()) as PlaceDetailsResponse;
  } catch (err) {
    return {
      ...empty,
      caveat: `Could not reach Google Places: ${err instanceof Error ? err.message : String(err)}.`,
    };
  }

  const sample: ReviewSample[] = (place.reviews ?? []).map((r) => ({
    rating: r.rating ?? null,
    text: r.text?.text ?? r.originalText?.text ?? null,
    publishedAt: r.publishTime ?? null,
    relativeTime: r.relativePublishTimeDescription ?? null,
    author: r.authorAttribution?.displayName ?? null,
  }));

  const rated = sample.filter((s) => typeof s.rating === 'number');
  const sampleAverage = rated.length
    ? Math.round((rated.reduce((sum, s) => sum + (s.rating ?? 0), 0) / rated.length) * 10) / 10
    : null;
  const negativeInSample = rated.filter((s) => (s.rating ?? 5) <= 2).length;
  const dates = sample.map((s) => s.publishedAt).filter((d): d is string => !!d).sort();
  const mostRecent = dates[dates.length - 1] ?? null;

  const observations: string[] = [];
  const total = place.userRatingCount ?? 0;
  const rating = place.rating ?? null;

  if (total === 0) {
    observations.push('The Google listing has no reviews, so it carries no social proof for people comparing options.');
  } else {
    observations.push(`The listing shows ${total} review(s)${rating ? ` averaging ${rating.toFixed(1)} stars` : ''}.`);
  }
  if (total > 0 && total < 10) {
    observations.push(
      `${total} review(s) is thin for a trading business — a review request routine typically moves this within a quarter.`,
    );
  }
  if (rating !== null && rating < 4.0 && total >= 5) {
    observations.push(
      `The average of ${rating.toFixed(1)} is below the 4.0 mark most people filter on when choosing between listings.`,
    );
  }
  if (mostRecent) {
    const months = (Date.now() - new Date(mostRecent).getTime()) / (30 * 86_400_000);
    if (months > 12) {
      observations.push(
        `The most recent review in the sample is about ${Math.round(months)} months old, which reads as a dormant listing.`,
      );
    }
  }
  if (negativeInSample > 0) {
    observations.push(
      `${negativeInSample} of the ${rated.length} sampled review(s) are 2 stars or below. Read them before any outreach — the wording matters.`,
    );
  }

  return {
    available: true,
    source: 'google_places',
    rating,
    totalReviews: total,
    sample,
    analysis: {
      sampleSize: sample.length,
      sampleAverage,
      negativeInSample,
      mostRecentReviewAt: mostRecent,
      recurringTerms: recurringTerms(sample.map((s) => s.text ?? '').filter(Boolean)),
    },
    observations,
    caveat: UNAVAILABLE_CAVEAT,
  };
}

// ---------------------------------------------------------------------------
// YouTube audience
// ---------------------------------------------------------------------------

/** Extracts a channel handle or id from a YouTube URL. */
export function parseYouTubeRef(url: string): { type: 'handle' | 'id' | 'user'; value: string } | null {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    if (segments[0]!.startsWith('@')) return { type: 'handle', value: segments[0]!.slice(1) };
    if (segments[0] === 'channel' && segments[1]) return { type: 'id', value: segments[1] };
    if ((segments[0] === 'c' || segments[0] === 'user') && segments[1]) {
      return { type: 'user', value: segments[1] };
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchYouTubeAudience(channelUrl: string): Promise<AudienceIntelligence> {
  const base: AudienceIntelligence = {
    platform: 'youtube',
    available: false,
    reason: '',
    metrics: {},
  };

  if (!integrations.youtube) {
    return {
      ...base,
      reason: 'YOUTUBE_API_KEY is not set, so channel statistics could not be read. Nothing has been estimated.',
    };
  }

  const ref = parseYouTubeRef(channelUrl);
  if (!ref) return { ...base, reason: `Could not identify a channel from ${channelUrl}.` };

  const params =
    ref.type === 'id'
      ? `id=${encodeURIComponent(ref.value)}`
      : ref.type === 'handle'
        ? `forHandle=${encodeURIComponent(ref.value)}`
        : `forUsername=${encodeURIComponent(ref.value)}`;

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&${params}&key=${env.YOUTUBE_API_KEY}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) return { ...base, reason: `YouTube API returned HTTP ${res.status}.` };

    const payload = (await res.json()) as {
      items?: {
        snippet?: { title?: string; publishedAt?: string; description?: string };
        statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string; hiddenSubscriberCount?: boolean };
      }[];
    };
    const channel = payload.items?.[0];
    if (!channel) return { ...base, reason: 'No channel found at that URL.' };

    const stats = channel.statistics ?? {};
    return {
      platform: 'youtube',
      available: true,
      reason: 'Read from the YouTube Data API.',
      metrics: {
        title: channel.snippet?.title ?? null,
        subscribers: stats.hiddenSubscriberCount ? 'hidden by the channel' : Number(stats.subscriberCount ?? 0),
        videos: Number(stats.videoCount ?? 0),
        totalViews: Number(stats.viewCount ?? 0),
        createdAt: channel.snippet?.publishedAt ?? null,
        hasDescription: channel.snippet?.description ? 'yes' : 'no',
      },
    };
  } catch (err) {
    return { ...base, reason: `Could not reach the YouTube API: ${err instanceof Error ? err.message : String(err)}.` };
  }
}

/**
 * Audience data for a platform that requires an admin-granted token.
 *
 * Always unavailable for a prospect, and the reason says why rather than
 * pretending the check simply failed.
 */
export function audienceRequiresPermission(platform: string): AudienceIntelligence {
  const reasons: Record<string, string> = {
    facebook:
      'Follower counts and comments are only available through the Meta Graph API for Pages the token holder administers. A prospect has not granted that, so this must be reviewed by a person.',
    instagram:
      'Instagram insights require a token granted by the account owner. Public follower counts cannot be read through the API, and scraping the page is against the platform terms.',
    linkedin:
      'LinkedIn organisation data requires an admin-granted token. There is no public endpoint for follower counts.',
    tiktok:
      'TikTok analytics require an account-holder token. Public profile figures cannot be read through the API.',
    x: 'X restricts profile metrics to paid API tiers with account authorisation.',
  };
  return {
    platform,
    available: false,
    reason:
      reasons[platform] ??
      'This platform does not expose audience data for accounts the token holder does not administer.',
    metrics: {},
  };
}

// ---------------------------------------------------------------------------
// Service and product visibility
// ---------------------------------------------------------------------------

/**
 * Can a visitor tell what this business actually sells?
 *
 * Assembled from what was genuinely read: the website audit's own services
 * check, and the Google listing's description and category. Social profiles are
 * marked for manual review rather than guessed at.
 */
export function assessServiceVisibility(input: {
  websiteStatesServices: boolean | null;
  gbpDescription: string | null;
  gbpCategory: string | null;
  socialProfileCount: number;
}): ServiceVisibility {
  const sources: ServiceVisibility['sources'] = [];
  const observations: string[] = [];

  sources.push({
    source: 'Website',
    statesServices: input.websiteStatesServices,
    detail:
      input.websiteStatesServices === null
        ? 'Not assessed — the site could not be read.'
        : input.websiteStatesServices
          ? 'A services or products section was found.'
          : 'No services or products section was found on the home page or in its navigation.',
  });

  sources.push({
    source: 'Google Business listing',
    statesServices: input.gbpDescription ? true : input.gbpCategory ? null : false,
    detail: input.gbpDescription
      ? 'A business description is published.'
      : input.gbpCategory
        ? `No description; the category "${input.gbpCategory}" is the only indication of what is sold.`
        : 'No description and no category, so the listing does not say what the business does.',
  });

  if (input.socialProfileCount > 0) {
    sources.push({
      source: 'Social profiles',
      statesServices: null,
      detail: `${input.socialProfileCount} profile(s) recorded. Whether each states what is sold requires a manual check — these platforms do not expose profile content through an API.`,
    });
  }

  const known = sources.filter((s) => s.statesServices !== null);
  const clear = known.length === 0 ? null : known.every((s) => s.statesServices === true);

  if (input.websiteStatesServices === false && !input.gbpDescription) {
    observations.push(
      'Neither the website nor the Google listing states what the business sells, so someone finding it has to guess.',
    );
  } else if (input.websiteStatesServices === false) {
    observations.push('The website does not set out the services, though the Google listing carries a description.');
  } else if (!input.gbpDescription) {
    observations.push(
      'The website explains the services but the Google listing does not, so people who never reach the site see less.',
    );
  }

  return { clear, sources, observations };
}
