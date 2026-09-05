import { obs, type ObservationDraft } from '../types';
import { integrations } from '@/lib/env';
import type { Platform } from '@/lib/enums';
import { PLATFORM_LABELS } from '@/lib/enums';

/**
 * Social and Google Business review.
 *
 * Every platform here is API-gated. Where no authorized token is configured the
 * group produces a structured manual-review checklist rather than scraping or
 * guessing. There is deliberately no scraping fallback: the product rules
 * forbid bypassing platform controls, and an unverified guess is worse than an
 * honest "not checked".
 */

export interface ChecklistItem {
  key: string;
  label: string;
  help?: string;
  /** `boolean` renders yes/no/unknown; `text` renders a free-text field. */
  kind: 'boolean' | 'text' | 'date';
}

export const SOCIAL_CHECKLIST: ChecklistItem[] = [
  { key: 'profile_exists', label: 'Profile exists at the supplied URL', kind: 'boolean' },
  { key: 'name_correct', label: 'Business name is correct and matches the website', kind: 'boolean' },
  { key: 'username_consistent', label: 'Username/handle is consistent across platforms', kind: 'boolean' },
  { key: 'logo_present', label: 'Profile picture / logo is present and current', kind: 'boolean' },
  { key: 'cover_present', label: 'Cover image is present and on-brand', kind: 'boolean' },
  { key: 'description_present', label: 'Business description is complete', kind: 'boolean' },
  { key: 'website_link_present', label: 'Website link is present', kind: 'boolean' },
  { key: 'website_link_correct', label: 'Website link points to the correct domain', kind: 'boolean' },
  { key: 'phone_present', label: 'Telephone number is published', kind: 'boolean' },
  { key: 'email_present', label: 'Email address is published', kind: 'boolean' },
  { key: 'location_present', label: 'Location is published', kind: 'boolean' },
  { key: 'cta_present', label: 'Call-to-action button is configured', kind: 'boolean' },
  { key: 'posting_frequency', label: 'Approximate posting frequency', kind: 'text', help: 'e.g. weekly, monthly, dormant' },
  { key: 'last_post_at', label: 'Date of the most recent public post', kind: 'date' },
  { key: 'content_consistent', label: 'Content is consistent and current', kind: 'boolean' },
  { key: 'brand_consistent', label: 'Branding matches the website and other channels', kind: 'boolean' },
  { key: 'video_used', label: 'Video content is used', kind: 'boolean' },
  { key: 'response_options', label: 'Customers can message or comment and receive replies', kind: 'boolean' },
  { key: 'links_working', label: 'Links in the profile work', kind: 'boolean' },
  { key: 'conversion_path', label: 'A clear path from profile to enquiry exists', kind: 'boolean' },
  { key: 'notes', label: 'Reviewer notes', kind: 'text' },
];

export const GBP_CHECKLIST: ChecklistItem[] = [
  { key: 'profile_exists', label: 'Google Business Profile exists', kind: 'boolean' },
  { key: 'name_correct', label: 'Business name matches the website', kind: 'boolean' },
  { key: 'category_set', label: 'Primary category is set and appropriate', kind: 'boolean' },
  { key: 'address_present', label: 'Address is published', kind: 'boolean' },
  { key: 'address_matches', label: 'Address matches the website', kind: 'boolean' },
  { key: 'phone_present', label: 'Telephone number is published', kind: 'boolean' },
  { key: 'phone_matches', label: 'Telephone number matches the website', kind: 'boolean' },
  { key: 'website_link', label: 'Website link is present and correct', kind: 'boolean' },
  { key: 'hours_published', label: 'Opening hours are published', kind: 'boolean' },
  { key: 'map_correct', label: 'Map pin is in the correct location', kind: 'boolean' },
  { key: 'review_count', label: 'Number of reviews', kind: 'text' },
  { key: 'rating', label: 'Average rating', kind: 'text' },
  { key: 'reviews_answered', label: 'Reviews receive responses', kind: 'boolean' },
  { key: 'photos_present', label: 'Recent photos are published', kind: 'boolean' },
  { key: 'description_present', label: 'Business description is complete', kind: 'boolean' },
  { key: 'service_areas', label: 'Service areas are configured', kind: 'boolean' },
  { key: 'notes', label: 'Reviewer notes', kind: 'text' },
];

export function checklistFor(platform: Platform): ChecklistItem[] {
  return platform === 'google_business' ? GBP_CHECKLIST : SOCIAL_CHECKLIST;
}

function apiAvailable(platform: Platform): boolean {
  switch (platform) {
    case 'facebook':
    case 'instagram':
      return integrations.meta;
    case 'linkedin':
      return integrations.linkedin;
    case 'youtube':
      return integrations.youtube;
    case 'google_business':
      return integrations.googlePlaces;
    default:
      return false;
  }
}

/**
 * Produces one `unverifiable` observation per profile, carrying the checklist
 * the auditor must complete. Completing an item in the UI upgrades the row to
 * `manual_verified` with the reviewer and timestamp.
 */
export function buildSocialReview(
  profiles: { id: string; platform: Platform; url: string; handle: string | null }[],
): ObservationDraft[] {
  const out: ObservationDraft[] = [];

  const socialProfiles = profiles.filter((p) => p.platform !== 'google_business');
  const group = 'social' as const;

  if (socialProfiles.length === 0) {
    out.push(
      obs.skipped(
        group,
        'social.profiles',
        'No social media profile URLs have been recorded for this organization. Add them on the Platforms tab to enable the review.',
      ),
    );
    return out;
  }

  for (const profile of socialProfiles) {
    const label = PLATFORM_LABELS[profile.platform];
    out.push(
      obs.unverifiable(
        group,
        `social.${profile.platform}`,
        apiAvailable(profile.platform)
          ? `An API token is configured for ${label}, but profile-level review still requires a human confirmation of brand and content quality.`
          : `${label} does not permit automated review without an authorized API token. A structured manual checklist has been prepared.`,
        {
          url: profile.url,
          rawValue: {
            profileId: profile.id,
            platform: profile.platform,
            handle: profile.handle,
            checklist: SOCIAL_CHECKLIST.map((i) => i.key),
            apiConfigured: apiAvailable(profile.platform),
          },
          source: 'manual_pending',
        },
      ),
    );
  }

  return out;
}

export function buildGbpReview(
  profile: { id: string; url: string } | null,
  organizationName: string,
): ObservationDraft[] {
  const group = 'gbp' as const;
  if (!profile) {
    return [
      obs.skipped(
        group,
        'gbp.profile',
        `No Google Business Profile URL has been recorded for ${organizationName}. Add one on the Platforms tab, or record that no profile exists.`,
      ),
    ];
  }
  return [
    obs.unverifiable(
      group,
      'gbp.profile',
      integrations.googlePlaces
        ? 'A Google Places key is configured. Fields retrieved from the API are marked as API-sourced; anything the API does not expose requires manual confirmation.'
        : 'Google Business review requires an authorized Google API key. A structured manual checklist has been prepared - no business details have been assumed.',
      {
        url: profile.url,
        rawValue: {
          profileId: profile.id,
          checklist: GBP_CHECKLIST.map((i) => i.key),
          apiConfigured: integrations.googlePlaces,
        },
        source: 'manual_pending',
      },
    ),
  ];
}
