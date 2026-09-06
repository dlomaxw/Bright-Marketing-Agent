import { db } from '@/lib/db';
import { parseStringArray } from '@/lib/json';
import { AppError } from '@/lib/api';
import { getSetting } from '@/server/settings';
import { logActivity } from '@/server/activity';
import { modelProvider } from '@/ai/provider';
import type { FindingProjection } from '@/ai/contract';
import { SEVERITY_WEIGHT, type Severity, isClientEligible } from '@/lib/enums';

/**
 * Report generation.
 *
 * Sections are assembled from findings that pass three tests: manually
 * verified, marked client-visible, and observed within the freshness window.
 * Everything else is listed in the "excluded" section with the reason, so the
 * analyst sees what was left out rather than discovering it later.
 */

export const REPORT_SECTIONS = [
  { key: 'cover', heading: 'Cover' },
  { key: 'organization', heading: 'Organization and website details' },
  { key: 'executive_summary', heading: 'Executive summary' },
  { key: 'presence', heading: 'Digital presence overview' },
  { key: 'website_findings', heading: 'Website findings' },
  { key: 'social_findings', heading: 'Social media findings' },
  { key: 'local_findings', heading: 'Google Business and local findings' },
  { key: 'conversion_findings', heading: 'Conversion and measurement findings' },
  { key: 'priorities', heading: 'Priority recommendations' },
  { key: 'quick_wins', heading: 'Quick wins' },
  { key: 'roadmap', heading: '30, 60 and 90 day improvement roadmap' },
  { key: 'kpis', heading: 'Suggested performance indicators' },
  { key: 'methodology', heading: 'Methodology' },
  { key: 'limitations', heading: 'Limitations' },
  { key: 'appendix', heading: 'Evidence appendix' },
] as const;

const CATEGORY_SECTION: Record<string, string> = {
  availability: 'website_findings',
  cms: 'website_findings',
  seo: 'website_findings',
  content: 'website_findings',
  performance: 'website_findings',
  mobile: 'website_findings',
  accessibility: 'website_findings',
  trust: 'website_findings',
  conversion: 'conversion_findings',
  social: 'social_findings',
  local: 'local_findings',
};

export interface BuildOptions {
  organizationId: string;
  actorId: string;
  useAi?: boolean;
}

export async function generateReport(options: BuildOptions): Promise<{ id: string; excluded: number; aiIssues: string[] }> {
  const org = await db.organization.findUnique({
    where: { id: options.organizationId },
    include: {
      findings: { where: { deletedAt: null } },
      auditRuns: { orderBy: { createdAt: 'desc' }, take: 5 },
      profiles: true,
    },
  });
  if (!org) throw new AppError('Organization not found.', 404);

  const outreach = await getSetting('outreach.rules');
  const brand = await getSetting('brand.details');
  const staleBefore = new Date(Date.now() - outreach.freshnessHours * 3600_000);

  const eligible = org.findings.filter(
    (f) =>
      isClientEligible(f.verificationStatus) &&
      f.clientVisible &&
      f.observedAt >= staleBefore &&
      !f.requiresReverification,
  );

  const excluded = org.findings
    .filter((f) => !eligible.includes(f))
    .map((f) => ({
      finding: f,
      reason: !f.clientVisible
        ? 'Not marked as client-facing'
        : !isClientEligible(f.verificationStatus)
          ? `Verification status is "${f.verificationStatus}"`
          : f.requiresReverification
            ? 'Imported - requires re-verification'
            : `Last observed ${f.observedAt.toISOString().slice(0, 10)}, outside the ${outreach.freshnessHours}-hour freshness window`,
    }));

  // --- AI or deterministic narrative ---------------------------------------
  const projection: FindingProjection[] = eligible.map((f) => ({
    id: f.reference,
    reference: f.reference,
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    observation: f.observation_text,
    evidence_url: f.evidenceUrl,
    observed_at: f.observedAt.toISOString(),
    recommendation: f.recommendation,
  }));

  const draft = await modelProvider().draft({
    organization: {
      name: org.brandName ?? org.legalName,
      industry: org.industry,
      city: org.city,
      country: org.country,
      website: org.website,
    },
    findings: projection,
    task: 'Draft a client-safe marketing audit report narrative from these verified findings.',
  });

  const aiIssues = draft.issues.map((i) => i.message);
  const narrative = draft.output;

  // --- Version -------------------------------------------------------------
  const latest = await db.report.findFirst({
    where: { organizationId: org.id },
    orderBy: { version: 'desc' },
  });
  const version = (latest?.version ?? 0) + 1;
  if (latest && latest.status !== 'superseded') {
    await db.report.update({ where: { id: latest.id }, data: { status: 'superseded' } });
  }

  const bySeverity = [...eligible].sort(
    (a, b) => SEVERITY_WEIGHT[b.severity as Severity] - SEVERITY_WEIGHT[a.severity as Severity],
  );

  const findingBlock = (list: typeof eligible): string =>
    list.length === 0
      ? 'No verified findings in this area.'
      : list
          .map((f) =>
            [
              `### ${f.reference} — ${f.observation_text}`,
              '',
              `**Severity:** ${f.severity} · **Confidence:** ${f.confidence}`,
              `**Evidence:** ${f.evidenceUrl ?? 'recorded during the audit run'}`,
              `**Observed:** ${f.observedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
              '',
              `We observed that ${lower(f.observation_text)}`,
              '',
              `This may affect the business as follows: ${lower(f.businessImpact)}`,
              '',
              `We recommend: ${lower(f.recommendation)}`,
            ].join('\n'),
          )
          .join('\n\n');

  const quickWins = bySeverity.filter((f) => ['critical', 'high'].includes(f.severity)).slice(0, 5);

  const sections: { key: string; heading: string; body: string; sortOrder: number }[] = [];
  const add = (key: string, body: string) => {
    const def = REPORT_SECTIONS.find((s) => s.key === key)!;
    sections.push({ key, heading: def.heading, body, sortOrder: sections.length });
  };

  add(
    'cover',
    [
      `# Digital presence audit`,
      '',
      `**${org.brandName ?? org.legalName}**`,
      org.website ? `Website: ${org.website}` : 'No website on record',
      `Audit date: ${new Date().toISOString().slice(0, 10)}`,
      '',
      `Prepared by ${brand.companyName}`,
      brand.addressLine,
    ].join('\n'),
  );

  add(
    'organization',
    [
      `| Field | Value |`,
      `| --- | --- |`,
      `| Organization | ${org.legalName} |`,
      `| Industry | ${org.industry ?? 'Not recorded'} |`,
      `| Location | ${[org.city, org.country].filter(Boolean).join(', ')} |`,
      `| Website | ${org.website ?? 'Not recorded'} |`,
      `| Audit runs reviewed | ${org.auditRuns.length} |`,
      `| Verified findings included | ${eligible.length} |`,
    ].join('\n'),
  );

  add(
    'executive_summary',
    narrative?.summary ??
      `We reviewed the public digital presence of ${org.brandName ?? org.legalName}. No verified findings are currently eligible for client-facing reporting.`,
  );

  add(
    'presence',
    [
      `**Website:** ${org.website ?? 'No website recorded.'}`,
      '',
      `**Public profiles supplied for review:** ${
        org.profiles.length === 0
          ? 'none recorded'
          : org.profiles.map((p) => `${p.platform} (${p.url})`).join(', ')
      }`,
      '',
      org.profiles.length > 0
        ? 'Social and Google Business profiles are reviewed manually against a structured checklist, because these platforms do not permit automated review without an authorised API token.'
        : '',
    ].join('\n'),
  );

  for (const [sectionKey, label] of [
    ['website_findings', 'website'],
    ['social_findings', 'social media'],
    ['local_findings', 'local and Google Business'],
    ['conversion_findings', 'conversion and measurement'],
  ] as const) {
    const list = eligible.filter((f) => (CATEGORY_SECTION[f.category] ?? 'website_findings') === sectionKey);
    add(sectionKey, list.length ? findingBlock(list) : `No verified ${label} findings were included in this report.`);
  }

  add(
    'priorities',
    bySeverity.length === 0
      ? 'No priority recommendations are available until findings have been verified.'
      : bySeverity
          .slice(0, 8)
          .map((f, i) => `${i + 1}. **${f.reference}** — ${lower(f.recommendation)} *(${f.severity})*`)
          .join('\n'),
  );

  add(
    'quick_wins',
    quickWins.length === 0
      ? 'No quick wins have been identified from the verified findings.'
      : [
          'Actions that can usually be completed within 7 to 14 days:',
          '',
          ...quickWins.map((f) => `- ${f.reference}: ${lower(f.recommendation)}`),
        ].join('\n'),
  );

  add(
    'roadmap',
    [
      '**Days 0-30 — Stabilise**',
      bulletFor(bySeverity, ['critical']),
      '',
      '**Days 30-60 — Improve**',
      bulletFor(bySeverity, ['high']),
      '',
      '**Days 60-90 — Grow and measure**',
      bulletFor(bySeverity, ['medium', 'low', 'informational']),
    ].join('\n'),
  );

  add(
    'kpis',
    [
      'Suggested indicators to track after the recommended work. Baselines must be established from the client’s own analytics; this report does not estimate current performance.',
      '',
      '- Enquiries received through the website, by channel (form, call, WhatsApp)',
      '- Percentage of enquiries with a recorded source',
      '- Pages indexed in search, and impressions for the main service terms',
      '- Home page load time on a mobile connection',
      '- Proportion of images served in a modern format',
      '- Google Business Profile views, direction requests and calls',
    ].join('\n'),
  );

  add(
    'methodology',
    [
      `This audit records publicly observable characteristics of ${org.brandName ?? org.legalName}'s public web presence.`,
      '',
      '- Requests were made only to publicly reachable pages, using an identifying user agent, honouring robots.txt, with rate limits and timeouts.',
      '- Only GET and HEAD requests were used. No authentication was attempted, no forms were submitted and no security testing was performed.',
      '- Each finding records the exact URL, the date and time of observation, the type of evidence and a confidence level.',
      '- Findings were reviewed and verified by a Bright Thoughts analyst before inclusion in this report.',
      '- Where a check could not be completed, it is reported as unverified rather than assumed.',
    ].join('\n'),
  );

  add(
    'limitations',
    [
      '- This is a review of publicly visible digital presence. It is **not** a security assessment, and nothing in it should be read as a statement about the security of any system.',
      '- Observations describe the site as it appeared at the times recorded. Websites change, and the current state may differ.',
      '- Accessibility observations are based on static markup only and are not a WCAG conformance audit.',
      '- Performance measurements cover document and image sizes actually retrieved. Field performance data requires an authorised measurement source and is not estimated.',
      '- Social media and Google Business observations are recorded by manual review, because these platforms do not permit automated review without an authorised API token.',
      excluded.length > 0
        ? `- ${excluded.length} observation(s) were excluded from this report. See the appendix for the reasons.`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  add(
    'appendix',
    [
      '**Evidence included**',
      '',
      eligible.length === 0
        ? 'None.'
        : eligible
            .map(
              (f) =>
                `- ${f.reference} · ${f.evidenceUrl ?? 'audit run record'} · observed ${f.observedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · confidence ${f.confidence}`,
            )
            .join('\n'),
      '',
      '**Excluded from this report**',
      '',
      excluded.length === 0
        ? 'None.'
        : excluded.map((e) => `- ${e.finding.reference}: ${e.reason}`).join('\n'),
      '',
      narrative && narrative.uncertainty_notes.length > 0
        ? `**Uncertainty notes**\n\n${narrative.uncertainty_notes.map((n) => `- ${n}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  const report = await db.report.create({
    data: {
      organizationId: org.id,
      version,
      title: `Digital presence audit — ${org.brandName ?? org.legalName}`,
      status: 'draft',
      auditRunIdsJson: JSON.stringify(org.auditRuns.map((r) => r.id)),
      preparedBy: options.actorId,
      generatedByAi: draft.provider === 'anthropic' && draft.ok,
      aiOutputJson: narrative ? JSON.stringify({ provider: draft.provider, issues: draft.issues, output: narrative }) : null,
      sections: { create: sections },
      findings: {
        create: [
          ...eligible.map((f, i) => ({ findingId: f.id, included: true, sortOrder: i })),
          ...excluded.map((e, i) => ({
            findingId: e.finding.id,
            included: false,
            excludeReason: e.reason,
            sortOrder: eligible.length + i,
          })),
        ],
      },
    },
  });

  await db.organization.update({
    where: { id: org.id },
    data: {
      stage: ['won', 'lost', 'nurture'].includes(org.stage) ? org.stage : 'report_ready',
    },
  });

  await logActivity({
    organizationId: org.id,
    actorId: options.actorId,
    action: 'report.generated',
    entityType: 'report',
    entityId: report.id,
    newValue: { version, included: eligible.length, excluded: excluded.length, provider: draft.provider },
  });

  return { id: report.id, excluded: excluded.length, aiIssues };
}

const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function bulletFor(findings: { reference: string; severity: string; recommendation: string }[], severities: string[]): string {
  const list = findings.filter((f) => severities.includes(f.severity));
  if (list.length === 0) return '- No actions in this window from the verified findings.';
  return list.map((f) => `- ${f.reference}: ${lower(f.recommendation)}`).join('\n');
}

export function serviceCodesFromFindings(findings: { recommendedServiceCodes: string }[]): string[] {
  return [...new Set(findings.flatMap((f) => parseStringArray(f.recommendedServiceCodes)))];
}
