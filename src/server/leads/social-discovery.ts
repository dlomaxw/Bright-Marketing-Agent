import { db } from '@/lib/db';
import { normalizeUrl } from '@/lib/normalize';
import { PLATFORMS, type Platform } from '@/lib/enums';
import { logActivity } from '@/server/activity';

/**
 * Discovers a prospect's social profiles from the links their own website
 * publishes.
 *
 * This is the honest half of social research. The business itself is telling us
 * which accounts are theirs, on a page we already fetched — so the profile URL
 * is evidence, not a guess. Contrast with searching a platform for a company
 * name, which returns lookalikes, fan pages and dormant duplicates that a
 * machine cannot tell apart.
 *
 * What it does NOT do: judge whether the profile is any good. Follower counts,
 * posting frequency and content quality come from an authorised API or an
 * analyst's eyes — the checklist in `src/audit/checks/social.ts`. Recording the
 * profile is what makes that review possible.
 */

interface PlatformMatcher {
  platform: Platform;
  pattern: RegExp;
  /** Paths that are the platform's own pages rather than a business profile. */
  ignore?: RegExp;
}

const MATCHERS: PlatformMatcher[] = [
  {
    platform: 'facebook',
    pattern: /^https?:\/\/(www\.|m\.|web\.)?facebook\.com\/(?!sharer|share\.php|dialog|plugins|tr\?)/i,
    ignore: /facebook\.com\/(sharer|share\.php|dialog|plugins|policies|help)/i,
  },
  {
    platform: 'instagram',
    pattern: /^https?:\/\/(www\.)?instagram\.com\/(?!p\/|reel\/|explore)/i,
  },
  {
    platform: 'linkedin',
    pattern: /^https?:\/\/([a-z]{2}\.)?(www\.)?linkedin\.com\/(company|in|showcase)\//i,
    ignore: /linkedin\.com\/(shareArticle|sharing|legal)/i,
  },
  {
    platform: 'x',
    pattern: /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/(?!intent|share|home|search)/i,
    ignore: /(twitter|x)\.com\/(intent|share|i\/)/i,
  },
  {
    platform: 'tiktok',
    pattern: /^https?:\/\/(www\.)?tiktok\.com\/@/i,
  },
  {
    platform: 'youtube',
    pattern: /^https?:\/\/(www\.|m\.)?youtube\.com\/(@|c\/|channel\/|user\/)/i,
    ignore: /youtube\.com\/(watch|embed|results)/i,
  },
  {
    platform: 'google_business',
    pattern: /^https?:\/\/((www\.)?google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|g\.page)/i,
  },
];

export interface DiscoveredProfile {
  platform: Platform;
  url: string;
  handle: string | null;
  /** The page we found the link on — the evidence for it being theirs. */
  foundOn: string;
}

/** Extracts the account name from a profile URL, where the shape allows. */
function handleFrom(platform: Platform, url: string): string | null {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    if (platform === 'linkedin') return segments[1] ?? null; // /company/<handle>
    if (platform === 'tiktok') return segments[0]?.replace(/^@/, '') ?? null;
    if (platform === 'youtube') {
      const first = segments[0]!;
      return first.startsWith('@') ? first.slice(1) : (segments[1] ?? null);
    }
    if (platform === 'google_business') return null; // map links carry no handle
    return segments[0] ?? null;
  } catch {
    return null;
  }
}

/** Classifies a URL as a social profile, or returns null. */
export function classifySocialUrl(rawUrl: string, foundOn: string): DiscoveredProfile | null {
  const url = normalizeUrl(rawUrl);
  if (!url) return null;

  for (const matcher of MATCHERS) {
    if (matcher.ignore?.test(url)) continue;
    if (!matcher.pattern.test(url)) continue;

    // A bare domain link (facebook.com/) is a platform link, not a profile.
    let path: string;
    try {
      path = new URL(url).pathname.replace(/\/+$/, '');
    } catch {
      continue;
    }
    if (matcher.platform !== 'google_business' && path.length <= 1) continue;

    return {
      platform: matcher.platform,
      url,
      handle: handleFrom(matcher.platform, url),
      foundOn,
    };
  }
  return null;
}

/** Finds every social profile linked from a page. */
export function discoverFromLinks(links: string[], foundOn: string): DiscoveredProfile[] {
  const seen = new Map<string, DiscoveredProfile>();
  for (const link of links) {
    const profile = classifySocialUrl(link, foundOn);
    if (!profile) continue;
    // One profile per platform: the first is normally the header or footer link.
    if (!seen.has(profile.platform)) seen.set(profile.platform, profile);
  }
  return [...seen.values()];
}

export interface SocialDiscoveryResult {
  discovered: DiscoveredProfile[];
  created: number;
  alreadyKnown: number;
}

/**
 * Records discovered profiles against an organization.
 *
 * Profiles arrive `unverified`, like every other imported detail — the link
 * proves the business published it, not that the account is active or complete.
 */
export async function recordDiscoveredProfiles(
  organizationId: string,
  links: string[],
  foundOn: string,
  actorId?: string,
): Promise<SocialDiscoveryResult> {
  const discovered = discoverFromLinks(links, foundOn);
  let created = 0;
  let alreadyKnown = 0;

  for (const profile of discovered) {
    const existing = await db.platformProfile.findFirst({
      where: { organizationId, platform: profile.platform },
    });
    if (existing) {
      alreadyKnown += 1;
      continue;
    }

    await db.platformProfile.create({
      data: {
        organizationId,
        platform: profile.platform,
        url: profile.url,
        handle: profile.handle,
        verificationStatus: 'unverified',
        notes: `Discovered automatically from a link published on ${profile.foundOn}.`,
      },
    });
    created += 1;
  }

  if (created > 0) {
    await logActivity({
      organizationId,
      actorId: actorId ?? null,
      action: 'social.profiles_discovered',
      entityType: 'organization',
      entityId: organizationId,
      newValue: {
        created,
        platforms: discovered.map((d) => d.platform),
      },
      reason: `Found ${created} social profile link(s) published on ${foundOn}.`,
    });
  }

  return { discovered, created, alreadyKnown };
}

export const SUPPORTED_PLATFORMS = PLATFORMS;
