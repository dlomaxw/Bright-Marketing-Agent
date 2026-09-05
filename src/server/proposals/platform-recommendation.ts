import type { Confidence, Severity } from '@/lib/enums';
import { SEVERITY_WEIGHT } from '@/lib/enums';

/**
 * Decides what to recommend about a prospect's web platform.
 *
 * Bright Thoughts builds custom platforms — a bespoke site, a CRM fitted to how
 * the business actually sells, an admin a non-technical person can run, and AI
 * services on top. That is a genuinely better answer for some businesses and
 * the wrong answer for others, and the difference is not a matter of taste.
 *
 * So this module can return "stay where you are". A recommendation to rebuild a
 * site that is working is the same category of error as inventing a finding:
 * it is a claim the evidence does not support, and a client who follows it
 * spends money for nothing. The engine therefore has to earn a migration
 * recommendation from what the audit actually observed.
 *
 * Pure function — no database, no clock. Every verdict returns the findings
 * that produced it so the proposal can show its working.
 */

export interface RecommendationFinding {
  id: string;
  reference: string;
  checkCode: string;
  category: string;
  severity: Severity;
  confidence: Confidence;
  observation: string;
}

export type PlatformVerdict =
  /** The platform itself is the problem. Rebuild on something we control. */
  | 'rebuild'
  /** Keep the platform, but it needs real work and ongoing governance. */
  | 'modernise'
  /** The site is sound. Fix the specific issues; do not sell a rebuild. */
  | 'maintain'
  /** Nothing to build on — there is no usable site at all. */
  | 'first_build';

export interface PlatformRecommendation {
  verdict: PlatformVerdict;
  headline: string;
  /** The case, in client-safe language, each point tied to findings. */
  rationale: { point: string; findingRefs: string[] }[];
  /** Service module codes this verdict justifies. */
  serviceCodes: string[];
  /** Stated plainly so nobody oversells. */
  honestCaveat: string;
  signals: {
    cmsResidue: number;
    governanceGaps: number;
    conversionGaps: number;
    measurementGaps: number;
    severityLoad: number;
    siteUnusable: boolean;
  };
}

/** Findings that show the CMS is unmanaged rather than merely imperfect. */
const CMS_RESIDUE = new Set([
  'wp.default_pages',
  'wp.hello_world',
  'wp.readme',
  'content.demo',
  'content.lorem',
  'staging.public',
  'content.placeholder_contact',
]);

/** Findings that show nobody is looking after the site. */
const GOVERNANCE = new Set([
  'link.internal_broken',
  'copyright.stale',
  'https.available',
  'https.redirect',
  'redirect.chain',
  'sitemap.missing',
  'robots.txt_missing',
]);

/** Findings that show the site is not set up to capture business. */
const CONVERSION = new Set([
  'form.present',
  'form.action_valid',
  'contact.phone_visible',
  'contact.email_visible',
  'whatsapp.link',
  'tel.link',
  'booking.present',
  'contact.page_missing',
]);

const MEASUREMENT = new Set(['analytics.tag_present', 'analytics.events_declared']);

/** The site does not usefully exist. */
const UNUSABLE = new Set([
  'dns.resolves',
  'http.reachable',
  'http.status',
  'page.holding',
  'page.parked',
  'dir.index',
  'page.empty',
  'gbp.no_website',
]);

export function recommendPlatform(
  findings: RecommendationFinding[],
  options: { hasWebsite: boolean } = { hasWebsite: true },
): PlatformRecommendation {
  const has = (set: Set<string>) => findings.filter((f) => set.has(f.checkCode));

  const cms = has(CMS_RESIDUE);
  const governance = has(GOVERNANCE);
  const conversion = has(CONVERSION);
  const measurement = has(MEASUREMENT);
  const unusable = has(UNUSABLE);

  const severityLoad = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  const refs = (list: RecommendationFinding[]) => list.map((f) => f.reference);

  const signals = {
    cmsResidue: cms.length,
    governanceGaps: governance.length,
    conversionGaps: conversion.length,
    measurementGaps: measurement.length,
    severityLoad,
    siteUnusable: unusable.length > 0,
  };

  const rationale: { point: string; findingRefs: string[] }[] = [];

  // --- No usable site ------------------------------------------------------
  if (!options.hasWebsite || unusable.length > 0) {
    rationale.push({
      point: !options.hasWebsite
        ? 'The organisation has no website on record, so there is nothing to repair — the question is what to build.'
        : 'The address does not currently serve a usable website, so repair is not the starting point.',
      findingRefs: refs(unusable),
    });
    if (conversion.length > 0) {
      rationale.push({
        point:
          'Because the build starts from nothing, enquiry capture and measurement can be designed in from the outset rather than retrofitted.',
        findingRefs: refs(conversion),
      });
    }
    return {
      verdict: 'first_build',
      headline: 'Build a website and enquiry system from the ground up',
      rationale,
      serviceCodes: [
        'custom_platform_build',
        'custom_crm',
        'web_management_tool',
        'conversion_crm',
        'digital_measurement',
        'content',
      ],
      honestCaveat:
        'This recommendation rests on the site being unreachable at the times recorded. If the outage was temporary, the right conversation is different — we would re-check before proposing.',
      signals,
    };
  }

  // --- Rebuild: the platform itself is the problem --------------------------
  // Earned when the CMS is visibly unmanaged AND the site is failing at the
  // things it exists to do. One or the other on its own is not enough.
  const platformIsUnmanaged = cms.length >= 2;
  const failingAtItsJob = conversion.length >= 2 || (conversion.length >= 1 && measurement.length >= 1);

  if (platformIsUnmanaged && failingAtItsJob) {
    rationale.push({
      point:
        'The site still publishes content that ships with the template rather than content written for the business, which suggests no one is able to maintain it confidently.',
      findingRefs: refs(cms),
    });
    rationale.push({
      point:
        'At the same time it is not set up to capture enquiries reliably, so improving the current build would mean paying to maintain a platform that is not doing its job.',
      findingRefs: refs(conversion),
    });
    if (measurement.length > 0) {
      rationale.push({
        point:
          'Nothing is measured, so there is currently no way to tell which changes help — a purpose-built platform lets enquiry tracking be part of the system rather than an add-on.',
        findingRefs: refs(measurement),
      });
    }
    if (governance.length > 0) {
      rationale.push({
        point:
          'Routine maintenance has also slipped, which is the pattern we see when a site is edited rarely because editing it is awkward.',
        findingRefs: refs(governance),
      });
    }

    return {
      verdict: 'rebuild',
      headline: 'Replace the third-party platform with a system built for the business',
      rationale,
      serviceCodes: [
        'custom_platform_build',
        'platform_migration',
        'custom_crm',
        'web_management_tool',
        'conversion_crm',
        'digital_measurement',
        'ai_assistant',
      ],
      honestCaveat:
        'A rebuild is the right answer here because the current platform is both unmaintained and not capturing enquiries. If the priority is cost rather than capability, the same findings can be addressed on the existing platform — we would rather say so than sell the larger project.',
      signals,
    };
  }

  // --- Modernise: keep the platform, fix it properly ------------------------
  if (cms.length > 0 || governance.length >= 2 || severityLoad >= 200) {
    if (cms.length > 0) {
      rationale.push({
        point:
          'Some template content is still published, which is a content and governance problem rather than a reason to replace the platform.',
        findingRefs: refs(cms),
      });
    }
    if (governance.length > 0) {
      rationale.push({
        point:
          'Several maintenance items have been left, so the work is to bring the site up to date and keep it there.',
        findingRefs: refs(governance),
      });
    }
    if (conversion.length > 0) {
      rationale.push({
        point: 'Enquiry capture can be improved without changing the underlying platform.',
        findingRefs: refs(conversion),
      });
    }

    return {
      verdict: 'modernise',
      headline: 'Keep the current platform and bring it up to standard',
      rationale,
      serviceCodes: [
        'wordpress_care',
        'website_redesign',
        'conversion_crm',
        'technical_seo',
        'digital_measurement',
        ...(measurement.length > 0 ? ['ai_assistant'] : []),
      ],
      honestCaveat:
        'We are not recommending a rebuild. The issues found are real but they are fixable on the current platform, and replacing it would cost more without solving anything the client is actually experiencing.',
      signals,
    };
  }

  // --- Maintain: the site is sound -----------------------------------------
  rationale.push({
    point:
      'The site is in reasonable order. The findings are specific and worth correcting, but none of them points to a problem with the platform itself.',
    findingRefs: refs(findings.slice(0, 5)),
  });
  if (measurement.length > 0) {
    rationale.push({
      point:
        'The clearest opportunity is measurement: without it there is no way to see which changes make a difference.',
      findingRefs: refs(measurement),
    });
  }

  return {
    verdict: 'maintain',
    headline: 'Correct the specific issues found — no platform change needed',
    rationale,
    serviceCodes: [
      'technical_seo',
      'digital_measurement',
      'conversion_crm',
      ...(findings.some((f) => f.category === 'performance') ? ['performance_images'] : []),
      ...(findings.some((f) => f.category === 'accessibility') ? ['accessibility'] : []),
    ],
    honestCaveat:
      'We would be doing this client a disservice by proposing a rebuild. What was found does not justify one.',
    signals,
  };
}

// ---------------------------------------------------------------------------
// AI services
// ---------------------------------------------------------------------------

export interface AiOpportunity {
  serviceCode: string;
  name: string;
  /** Why this business specifically — tied to findings, never generic. */
  justification: string;
  findingRefs: string[];
}

/**
 * Suggests AI services where the audit shows a gap they genuinely address.
 *
 * Deliberately conservative. "Every business needs AI" is not a proposal, it is
 * a slogan, and a client who buys on that basis is the client who cancels. Each
 * suggestion here has to point at something the audit observed, and none of them
 * promises a result.
 */
export function recommendAiServices(findings: RecommendationFinding[]): AiOpportunity[] {
  const out: AiOpportunity[] = [];
  const by = (codes: string[]) => findings.filter((f) => codes.includes(f.checkCode));

  const noConversation = by(['whatsapp.link', 'form.present', 'contact.page_missing', 'booking.present']);
  if (noConversation.length >= 2) {
    out.push({
      serviceCode: 'ai_assistant',
      name: 'AI enquiry assistant',
      justification:
        'Visitors currently have few ways to ask a question, and enquiries that arrive outside working hours wait for a reply. An assistant on the site can answer common questions, capture the enquiry with its context, and hand anything it cannot answer to a person.',
      findingRefs: noConversation.map((f) => f.reference),
    });
  }

  const noMeasurement = by(['analytics.tag_present', 'analytics.events_declared']);
  if (noMeasurement.length > 0) {
    out.push({
      serviceCode: 'ai_reporting',
      name: 'AI-assisted reporting',
      justification:
        'Nothing is currently measured, so the first task is to record enquiries and their sources. Once there is data, monthly reporting can be drafted automatically and reviewed by a person, rather than assembled by hand.',
      findingRefs: noMeasurement.map((f) => f.reference),
    });
  }

  const thinContent = by(['page.thin', 'services.missing', 'about.missing', 'content.demo', 'content.lorem']);
  if (thinContent.length >= 2) {
    out.push({
      serviceCode: 'ai_content_ops',
      name: 'AI-assisted content production',
      justification:
        'Several pages are thin or still carry template text. AI drafting shortens the time to a first version of each page; the business still approves the wording before it is published.',
      findingRefs: thinContent.map((f) => f.reference),
    });
  }

  const localGaps = by(['gbp.no_description', 'gbp.few_photos', 'gbp.no_hours', 'schema.localbusiness', 'nap.present']);
  if (localGaps.length >= 2) {
    out.push({
      serviceCode: 'ai_local_presence',
      name: 'AI-assisted local presence management',
      justification:
        'The local listing is incomplete in several places. Drafting descriptions, posts and review replies with AI keeps the listing active without it becoming somebody’s daily chore.',
      findingRefs: localGaps.map((f) => f.reference),
    });
  }

  return out;
}
