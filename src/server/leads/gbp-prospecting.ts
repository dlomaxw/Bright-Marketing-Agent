import { env, integrations } from '@/lib/env';
import { db } from '@/lib/db';
import { domainKey, nameKey, normalizeUrl, phoneKey } from '@/lib/normalize';
import { logActivity } from '@/server/activity';
import {
  DEFAULT_THRESHOLDS,
  qualifyBusiness,
  type BusinessProfileSignals,
  type QualificationResult,
  type QualificationThresholds,
} from './qualification';

/**
 * Finds Ugandan businesses that are listed on Google but have no website.
 *
 * The flow is deliberately gated:
 *
 *   Google Places search
 *      -> full profile lookup (reviews, photos, hours, phone, website)
 *      -> QUALIFICATION GATE  (established? actually needs the service?)
 *      -> only qualified businesses become prospects
 *      -> findings recorded from the profile, still unverified
 *      -> a human reviews before any report, proposal or outreach
 *
 * Nothing is invented. Every field comes from the Places API response, and the
 * `googleMapsUri` is stored so any claim can be checked against the listing it
 * came from. With no API key configured this returns an explicit
 * "not configured" result rather than falling back to a model, because a model
 * asked to name businesses will produce plausible ones that do not exist.
 */

const PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

/** Only the fields we actually use — Places bills per field mask. */
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.types',
  'places.primaryTypeDisplayName',
  'places.photos',
  'places.regularOpeningHours',
  'places.editorialSummary',
  'places.googleMapsUri',
].join(',');

interface PlacesResponse {
  places?: {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    internationalPhoneNumber?: string;
    websiteUri?: string;
    rating?: number;
    userRatingCount?: number;
    businessStatus?: string;
    types?: string[];
    primaryTypeDisplayName?: { text?: string };
    photos?: unknown[];
    regularOpeningHours?: unknown;
    editorialSummary?: { text?: string };
    googleMapsUri?: string;
  }[];
}

export interface GbpProspectingOptions {
  /** e.g. "hotels in Kampala", "dental clinics Uganda". */
  query: string;
  actorId: string;
  maxResults?: number;
  thresholds?: Partial<QualificationThresholds>;
  /** Evaluate and report without writing any prospect. */
  dryRun?: boolean;
}

export interface EvaluatedBusiness {
  placeId: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviews: number | null;
  googleMapsUri: string | null;
  category: string | null;
  qualification: QualificationResult;
  /** Set only when the business was qualified and recorded. */
  organizationId: string | null;
}

export interface GbpProspectingOutcome {
  configured: boolean;
  query: string;
  searched: number;
  qualified: number;
  needsManualReview: number;
  rejected: number;
  created: number;
  alreadyKnown: number;
  businesses: EvaluatedBusiness[];
  message: string;
}

function toSignals(place: NonNullable<PlacesResponse['places']>[number]): BusinessProfileSignals {
  return {
    name: place.displayName?.text ?? 'Unnamed listing',
    businessStatus: place.businessStatus ?? null,
    websiteUri: place.websiteUri ?? null,
    nationalPhoneNumber: place.nationalPhoneNumber ?? null,
    internationalPhoneNumber: place.internationalPhoneNumber ?? null,
    formattedAddress: place.formattedAddress ?? null,
    rating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? null,
    photoCount: Array.isArray(place.photos) ? place.photos.length : 0,
    hasOpeningHours: !!place.regularOpeningHours,
    hasDescription: !!place.editorialSummary?.text,
    primaryType: place.primaryTypeDisplayName?.text ?? null,
    types: place.types ?? [],
    googleMapsUri: place.googleMapsUri ?? null,
  };
}

export async function findBusinessesWithoutWebsites(
  options: GbpProspectingOptions,
): Promise<GbpProspectingOutcome> {
  const query = options.query.trim();
  const maxResults = Math.min(options.maxResults ?? 20, 20);
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };

  const base: GbpProspectingOutcome = {
    configured: integrations.googlePlaces,
    query,
    searched: 0,
    qualified: 0,
    needsManualReview: 0,
    rejected: 0,
    created: 0,
    alreadyKnown: 0,
    businesses: [],
    message: '',
  };

  if (!integrations.googlePlaces) {
    return {
      ...base,
      message:
        'Google Places is not configured, so business discovery cannot run. Set GOOGLE_PLACES_API_KEY. ' +
        'Discovery is deliberately not delegated to a language model: asked to name businesses it will produce plausible ones that do not exist.',
    };
  }

  let payload: PlacesResponse;
  try {
    const res = await fetch(PLACES_SEARCH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: maxResults,
        // Keep discovery inside the market the agency serves.
        includedType: undefined,
        regionCode: 'UG',
        languageCode: 'en',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const detail = await res.text();
      return {
        ...base,
        message: `Google Places returned HTTP ${res.status}. No prospects were recorded. ${detail.slice(0, 200)}`,
      };
    }
    payload = (await res.json()) as PlacesResponse;
  } catch (err) {
    return {
      ...base,
      message: `Could not reach Google Places: ${err instanceof Error ? err.message : String(err)}. No prospects were recorded.`,
    };
  }

  const places = payload.places ?? [];
  base.searched = places.length;

  for (const place of places) {
    const signals = toSignals(place);
    const qualification = qualifyBusiness(signals, [], thresholds);

    const evaluated: EvaluatedBusiness = {
      placeId: place.id ?? null,
      name: signals.name,
      address: signals.formattedAddress ?? null,
      phone: signals.nationalPhoneNumber ?? signals.internationalPhoneNumber ?? null,
      website: signals.websiteUri ?? null,
      rating: signals.rating ?? null,
      reviews: signals.userRatingCount ?? null,
      googleMapsUri: signals.googleMapsUri ?? null,
      category: signals.primaryType ?? null,
      qualification,
      organizationId: null,
    };

    if (qualification.verdict === 'qualified') base.qualified += 1;
    else if (qualification.verdict === 'needs_manual_review') base.needsManualReview += 1;
    else base.rejected += 1;

    // Only qualified businesses are recorded. Everything else is reported back
    // so the analyst can see what was considered and why it was set aside —
    // but it does not enter the pipeline.
    if (qualification.verdict === 'qualified' && !options.dryRun) {
      const nKey = nameKey(signals.name);
      const website = normalizeUrl(signals.websiteUri ?? '');
      const dKey = domainKey(website);

      const existing = await db.organization.findFirst({
        where: {
          deletedAt: null,
          OR: [...(dKey ? [{ domainKey: dKey }] : []), { nameKey: nKey }],
        },
      });

      if (existing) {
        base.alreadyKnown += 1;
        evaluated.organizationId = existing.id;
      } else {
        const org = await createProspect(evaluated, signals, qualification, options.actorId);
        evaluated.organizationId = org.id;
        base.created += 1;
      }
    }

    base.businesses.push(evaluated);
  }

  base.message =
    base.searched === 0
      ? `Google Places returned no results for "${query}".`
      : `Evaluated ${base.searched} listing(s): ${base.qualified} qualified, ` +
        `${base.needsManualReview} need manual review, ${base.rejected} rejected. ` +
        `${base.created} new prospect(s) recorded` +
        (base.alreadyKnown ? `, ${base.alreadyKnown} already known` : '') +
        '. Findings are unverified until a person reviews them.';

  await logActivity({
    actorId: options.actorId,
    action: 'lead.gbp_prospecting',
    entityType: 'discovery',
    entityId: query,
    newValue: {
      searched: base.searched,
      qualified: base.qualified,
      rejected: base.rejected,
      created: base.created,
    },
    reason: `Google Business discovery for "${query}".`,
  });

  return base;
}

async function createProspect(
  evaluated: EvaluatedBusiness,
  signals: BusinessProfileSignals,
  qualification: QualificationResult,
  actorId: string,
) {
  const website = normalizeUrl(signals.websiteUri ?? '');
  const pKey = phoneKey(evaluated.phone);

  const notes = [
    `Discovered on Google Business on ${new Date().toISOString().slice(0, 10)}.`,
    evaluated.googleMapsUri ? `Listing: ${evaluated.googleMapsUri}` : '',
    `Qualification: ${qualification.verdict} (established ${qualification.establishedScore}, need ${qualification.needScore}).`,
    ...qualification.reasons.map((r) => `- ${r}`),
    evaluated.category ? `Google category: ${evaluated.category}` : '',
    evaluated.address ? `Address (as published on Google): ${evaluated.address}` : '',
    'Details are as published on the Google listing and have not been confirmed with the business.',
  ]
    .filter(Boolean)
    .join('\n');

  const org = await db.organization.create({
    data: {
      legalName: signals.name,
      nameKey: nameKey(signals.name),
      website,
      domainKey: domainKey(website),
      industry: evaluated.category ?? null,
      country: 'Uganda',
      city: null,
      sector: 'standard',
      // Discovered, qualified, but not yet researched by a person.
      stage: 'researching',
      source: 'research',
      sourceUrl: evaluated.googleMapsUri,
      ownerId: actorId,
      isDemoData: false,
      tagsJson: JSON.stringify(['google-business', website ? 'has-website' : 'no-website']),
      notes,
      // The telephone number is published on the listing, so it is recorded with
      // that provenance — and still unverified, like every imported contact.
      contacts: evaluated.phone
        ? {
            create: {
              name: '(name not published on the listing)',
              phone: evaluated.phone,
              phoneKey: pKey,
              sourceUrl: evaluated.googleMapsUri,
              sourceNote: 'Published on the Google Business listing',
              verificationStatus: 'unverified',
              isPrimary: true,
            },
          }
        : undefined,
      profiles: evaluated.googleMapsUri
        ? {
            create: {
              platform: 'google_business',
              url: evaluated.googleMapsUri,
              verificationStatus: 'unverified',
            },
          }
        : undefined,
    },
  });

  await recordProfileFindings(org.id, signals, qualification);

  await logActivity({
    organizationId: org.id,
    actorId,
    action: 'lead.qualified',
    entityType: 'organization',
    entityId: org.id,
    newValue: {
      establishedScore: qualification.establishedScore,
      needScore: qualification.needScore,
      reviews: evaluated.reviews,
      rating: evaluated.rating,
      hasWebsite: !!website,
    },
    reason: qualification.opportunitySummary ?? 'Qualified from the Google Business listing.',
  });

  return org;
}

/**
 * Records what the listing shows as findings.
 *
 * These are observations of a public Google Business Profile, with the listing
 * URL as evidence — the same standard as every other finding. They are created
 * `auto_detected` and not client-visible, so a person still reviews them.
 */
async function recordProfileFindings(
  organizationId: string,
  signals: BusinessProfileSignals,
  qualification: QualificationResult,
): Promise<void> {
  const { createFindingsFromChecks } = await import('@/server/findings/classify');
  const observedAt = new Date();
  const evidenceUrl = signals.googleMapsUri ?? null;

  const checks: { checkCode: string; detail: string }[] = [];

  if (!signals.websiteUri) {
    checks.push({
      checkCode: 'gbp.no_website',
      detail:
        `The Google Business listing for ${signals.name} publishes no website address` +
        (signals.userRatingCount ? `, despite ${signals.userRatingCount} customer review(s)` : '') +
        '.',
    });
  } else if (/facebook\.com|instagram\.com|linktr\.ee|business\.site/i.test(signals.websiteUri)) {
    checks.push({
      checkCode: 'gbp.social_as_website',
      detail: `The Google Business listing uses ${signals.websiteUri} in place of a website the business controls.`,
    });
  }

  if (!signals.hasDescription) {
    checks.push({
      checkCode: 'gbp.no_description',
      detail: 'The Google Business listing publishes no business description.',
    });
  }
  if ((signals.photoCount ?? 0) < 5) {
    checks.push({
      checkCode: 'gbp.few_photos',
      detail: `The Google Business listing has ${signals.photoCount ?? 0} photo(s).`,
    });
  }
  if (!signals.hasOpeningHours) {
    checks.push({
      checkCode: 'gbp.no_hours',
      detail: 'The Google Business listing publishes no opening hours.',
    });
  }

  await createFindingsFromChecks({
    organizationId,
    checks: checks.map((c) => ({ ...c, url: evidenceUrl, observedAt })),
    source: 'automated',
    note: `Observed on the public Google Business listing. Established score ${qualification.establishedScore}, need score ${qualification.needScore}.`,
  });
}
