import { db } from '@/lib/db';
import { createFindingsFromChecks } from '@/server/findings/classify';
import { logActivity } from '@/server/activity';
import {
  assessServiceVisibility,
  audienceRequiresPermission,
  fetchReviewIntelligence,
  fetchYouTubeAudience,
  type AudienceIntelligence,
  type ReviewIntelligence,
  type ServiceVisibility,
} from './social-intelligence';

/**
 * Runs the deep review and audience pass for one organization, and records
 * whatever it could genuinely read as findings.
 *
 * Everything here goes through the same classifier and the same defaults as the
 * website crawler — `auto_detected`, not client-visible — because a review count
 * read from an API is still an observation a person should look at before it is
 * put in front of the business it describes.
 */

export interface ReviewAuditResult {
  organizationId: string;
  reviews: ReviewIntelligence | null;
  audiences: AudienceIntelligence[];
  serviceVisibility: ServiceVisibility;
  findingsCreated: number;
  manualReviewNeeded: string[];
}

/** Extracts a Places id from a stored Google Business URL, where one is present. */
export function placeIdFromUrl(url: string): string | null {
  // Discovery stores the API's own place id in the profile handle when it has
  // one; a plain maps link does not carry an id we can use.
  const match = url.match(/[?&](?:place_id|cid)=([^&]+)/) ?? url.match(/\/place\/[^/]+\/([A-Za-z0-9_-]{20,})/);
  return match?.[1] ?? null;
}

export async function runReviewAudit(
  organizationId: string,
  actorId?: string,
): Promise<ReviewAuditResult> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      profiles: true,
      findings: { where: { deletedAt: null }, select: { checkCode: true } },
    },
  });
  if (!org) throw new Error('Organization not found.');

  const manualReviewNeeded: string[] = [];
  const checks: { checkCode: string; detail: string; url: string | null; observedAt: Date }[] = [];
  const observedAt = new Date();

  // --- Google reviews -------------------------------------------------------
  const gbp = org.profiles.find((p) => p.platform === 'google_business');
  let reviews: ReviewIntelligence | null = null;

  if (gbp) {
    const placeId = gbp.handle || placeIdFromUrl(gbp.url);
    if (placeId) {
      reviews = await fetchReviewIntelligence(placeId);

      if (reviews.available) {
        const total = reviews.totalReviews ?? 0;
        const rating = reviews.rating;

        if (total === 0) {
          checks.push({
            checkCode: 'gbp.no_reviews',
            detail: 'The Google Business listing has no reviews.',
            url: gbp.url,
            observedAt,
          });
        } else if (total < 10) {
          checks.push({
            checkCode: 'gbp.few_reviews',
            detail: `The Google Business listing has ${total} review(s).`,
            url: gbp.url,
            observedAt,
          });
        }

        if (rating !== null && rating < 4.0 && total >= 5) {
          checks.push({
            checkCode: 'gbp.low_rating',
            detail: `The Google Business listing averages ${rating.toFixed(1)} stars across ${total} review(s).`,
            url: gbp.url,
            observedAt,
          });
        }

        const recent = reviews.analysis.mostRecentReviewAt;
        if (recent && Date.now() - new Date(recent).getTime() > 365 * 86_400_000) {
          checks.push({
            checkCode: 'gbp.reviews_dormant',
            detail: `The most recent review in the sample was published ${recent.slice(0, 10)}.`,
            url: gbp.url,
            observedAt,
          });
        }
      } else {
        manualReviewNeeded.push(`Google reviews: ${reviews.caveat}`);
      }
    } else {
      manualReviewNeeded.push(
        'Google reviews: the stored listing URL does not carry a place id, so reviews must be read manually from the listing.',
      );
    }
  } else {
    manualReviewNeeded.push('No Google Business profile is recorded, so reviews could not be checked.');
  }

  // --- Audience per platform ------------------------------------------------
  const audiences: AudienceIntelligence[] = [];
  for (const profile of org.profiles) {
    if (profile.platform === 'google_business') continue;

    if (profile.platform === 'youtube') {
      const audience = await fetchYouTubeAudience(profile.url);
      audiences.push(audience);
      if (audience.available) {
        // Subscriber and view counts are recorded on the profile, not turned
        // into a finding — "few subscribers" is not a defect, it is context.
        await db.platformProfile.update({
          where: { id: profile.id },
          data: {
            followers:
              typeof audience.metrics.subscribers === 'number' ? audience.metrics.subscribers : null,
            lastCheckedAt: new Date(),
            notes: `YouTube Data API: ${audience.metrics.videos} video(s), ${audience.metrics.totalViews} total view(s).`,
          },
        });
      } else {
        manualReviewNeeded.push(`YouTube: ${audience.reason}`);
      }
      continue;
    }

    const audience = audienceRequiresPermission(profile.platform);
    audiences.push(audience);
    manualReviewNeeded.push(`${profile.platform}: ${audience.reason}`);
  }

  // --- Service and product visibility ---------------------------------------
  // Reuses what the website audit already established rather than re-deriving it.
  const websiteStatesServices = org.findings.some((f) => f.checkCode === 'services.missing')
    ? false
    : org.website
      ? true
      : null;

  const serviceVisibility = assessServiceVisibility({
    websiteStatesServices,
    gbpDescription: org.findings.some((f) => f.checkCode === 'gbp.no_description') ? null : gbp ? '' : null,
    gbpCategory: org.industry,
    socialProfileCount: org.profiles.filter((p) => p.platform !== 'google_business').length,
  });

  if (serviceVisibility.clear === false) {
    checks.push({
      checkCode: 'social.services_unclear',
      detail:
        serviceVisibility.observations[0] ??
        'The public profiles do not clearly state what the business sells.',
      url: gbp?.url ?? org.website,
      observedAt,
    });
  }

  const result = await createFindingsFromChecks({
    organizationId,
    checks,
    source: 'automated',
    note: 'Recorded during the review and audience pass.',
  });

  if (checks.length > 0 || audiences.length > 0) {
    await logActivity({
      organizationId,
      actorId: actorId ?? null,
      action: 'audit.reviews_checked',
      entityType: 'organization',
      entityId: organizationId,
      newValue: {
        rating: reviews?.rating ?? null,
        totalReviews: reviews?.totalReviews ?? null,
        findingsCreated: result.created,
        platformsChecked: audiences.map((a) => a.platform),
      },
      reason: 'Deep review and audience pass.',
    });
  }

  return {
    organizationId,
    reviews,
    audiences,
    serviceVisibility,
    findingsCreated: result.created,
    manualReviewNeeded,
  };
}
