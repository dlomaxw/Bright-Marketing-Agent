import type { CheckGroup } from '@/lib/enums';
import { CHECK_GROUP_LABELS } from '@/lib/enums';
import type { AuditContext, ObservationDraft } from './types';
import { runAvailability } from './checks/availability';
import { runCms } from './checks/cms';
import { runSeo } from './checks/seo';
import { runContent, runConversion, runLocal, runMobile, runPerformance, runTrust } from './checks/web-misc';

export const ENGINE_VERSION = '0.1.0';

export interface GroupRunner {
  group: CheckGroup;
  title: string;
  /** True when the crawler can run it unaided. Social/GBP are human or API driven. */
  automated: boolean;
  description: string;
  run: (ctx: AuditContext) => Promise<ObservationDraft[]>;
}

export const GROUP_RUNNERS: Record<string, GroupRunner> = {
  availability: {
    group: 'availability',
    title: CHECK_GROUP_LABELS.availability,
    automated: true,
    description:
      'DNS, HTTP status, HTTPS, redirect chain, holding and parked pages, directory listings.',
    run: runAvailability,
  },
  cms: {
    group: 'cms',
    title: CHECK_GROUP_LABELS.cms,
    automated: true,
    description:
      'Default CMS pages, demo and placeholder content, placeholder contact details, public staging sites.',
    run: runCms,
  },
  seo: {
    group: 'seo',
    title: CHECK_GROUP_LABELS.seo,
    automated: true,
    description:
      'Titles, meta descriptions, headings, canonical, robots.txt, sitemap, indexability, internal links, structured data.',
    run: runSeo,
  },
  content: {
    group: 'content',
    title: CHECK_GROUP_LABELS.content,
    automated: true,
    description: 'Content depth, services and about sections, stale dates, contact page.',
    run: runContent,
  },
  performance: {
    group: 'performance',
    title: CHECK_GROUP_LABELS.performance,
    automated: true,
    description:
      'Document weight, measured image sizes and formats, lazy loading, render-blocking assets.',
    run: runPerformance,
  },
  mobile: {
    group: 'mobile',
    title: CHECK_GROUP_LABELS.mobile,
    automated: true,
    description: 'Viewport, alt text, form labels, link text, document language.',
    run: runMobile,
  },
  conversion: {
    group: 'conversion',
    title: CHECK_GROUP_LABELS.conversion,
    automated: true,
    description:
      'Visible contact details, forms, click-to-call, WhatsApp, booking paths, measurement tags.',
    run: runConversion,
  },
  trust: {
    group: 'trust',
    title: CHECK_GROUP_LABELS.trust,
    automated: true,
    description: 'Privacy and terms pages, team information, social profile links.',
    run: runTrust,
  },
  local: {
    group: 'local',
    title: CHECK_GROUP_LABELS.local,
    automated: true,
    description: 'Address, phone and location signals, maps, opening hours, LocalBusiness schema.',
    run: runLocal,
  },
  social: {
    group: 'social',
    title: CHECK_GROUP_LABELS.social,
    automated: false,
    description:
      'Structured manual review of supplied public profiles. Uses official APIs only where an authorized token exists.',
    run: async () => [],
  },
  gbp: {
    group: 'gbp',
    title: CHECK_GROUP_LABELS.gbp,
    automated: false,
    description:
      'Google Business Profile review via an approved API, or a manual verification form.',
    run: async () => [],
  },
};

export const AUTOMATED_GROUPS = Object.values(GROUP_RUNNERS)
  .filter((g) => g.automated)
  .map((g) => g.group);

export const ALL_GROUPS = Object.values(GROUP_RUNNERS).map((g) => g.group);
