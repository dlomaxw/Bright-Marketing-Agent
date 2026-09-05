import { db } from '@/lib/db';
import { PLATFORM_LABELS, SEVERITY_WEIGHT, type Platform, type Severity } from '@/lib/enums';
import { getSetting } from '@/server/settings';

/**
 * The internal research brief.
 *
 * This is what the agent produces after running an audit: everything it found,
 * organised so an analyst can review it quickly. It is deliberately **not** the
 * client-facing audit report — that one is built only from findings a person has
 * verified, and generating it from unreviewed machine output is exactly the
 * failure this product exists to prevent.
 *
 * So the brief is honest about its own status: every observation is labelled
 * with whether it has been verified, and the document says plainly that it is
 * internal. It gives the analyst a head start; it does not give them a shortcut
 * past the review.
 */

export interface ResearchBrief {
  organizationId: string;
  organizationName: string;
  website: string | null;
  generatedAt: string;
  /** Markdown, using the same subset as the report and proposal renderers. */
  markdown: string;
  stats: {
    totalFindings: number;
    verified: number;
    awaitingReview: number;
    clientFacing: number;
    stale: number;
    bySeverity: Record<string, number>;
    socialProfiles: number;
    unverifiableChecks: number;
  };
  readyForClientReport: boolean;
  nextSteps: string[];
}

export async function buildResearchBrief(organizationId: string): Promise<ResearchBrief | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      findings: { where: { deletedAt: null }, orderBy: [{ severity: 'asc' }, { observedAt: 'desc' }] },
      profiles: { orderBy: { platform: 'asc' } },
      contacts: { where: { deletedAt: null } },
      auditRuns: { orderBy: { createdAt: 'desc' }, take: 1, include: { observations: true } },
    },
  });
  if (!org || org.deletedAt) return null;

  const outreach = await getSetting('outreach.rules');
  const staleBefore = new Date(Date.now() - outreach.freshnessHours * 3600_000);

  const verified = org.findings.filter((f) => f.verificationStatus === 'manually_verified');
  const awaiting = org.findings.filter((f) =>
    ['auto_detected', 'needs_review'].includes(f.verificationStatus),
  );
  const clientFacing = verified.filter((f) => f.clientVisible);
  const stale = verified.filter((f) => f.observedAt < staleBefore);

  const bySeverity: Record<string, number> = {};
  for (const f of org.findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

  const latestRun = org.auditRuns[0];
  const unverifiable = latestRun?.observations.filter((o) => o.outcome === 'unverifiable') ?? [];

  const sorted = [...org.findings].sort(
    (a, b) => SEVERITY_WEIGHT[b.severity as Severity] - SEVERITY_WEIGHT[a.severity as Severity],
  );

  const statusLabel = (f: (typeof org.findings)[number]) =>
    f.clientVisible
      ? 'verified, client-facing'
      : f.verificationStatus === 'manually_verified'
        ? 'verified, internal'
        : f.verificationStatus === 'needs_review'
          ? '**needs review**'
          : '**unreviewed**';

  const lines: string[] = [];

  lines.push(`# Research brief — ${org.brandName ?? org.legalName}`);
  lines.push('');
  lines.push(
    '**Internal working document.** It lists everything the audit detected, including ' +
      'observations no one has checked yet. Do not send it to a client and do not quote it ' +
      'externally. The client-facing report is generated separately, from verified findings only.',
  );
  lines.push('');

  // --- Summary --------------------------------------------------------------
  lines.push('## At a glance');
  lines.push('');
  lines.push('| | |');
  lines.push('| --- | --- |');
  lines.push(`| Website | ${org.website ?? 'none on record'} |`);
  lines.push(`| Industry | ${org.industry ?? 'not recorded'} |`);
  lines.push(`| Stage | ${org.stage.replace(/_/g, ' ')} |`);
  lines.push(`| Opportunity score | ${org.opportunityScore ?? 'not scored'} |`);
  lines.push(`| Evidence confidence | ${org.confidenceScore ?? 'not scored'} |`);
  lines.push(`| Findings detected | ${org.findings.length} |`);
  lines.push(`| Verified by a person | ${verified.length} |`);
  lines.push(`| Awaiting review | ${awaiting.length} |`);
  lines.push(`| Approved for client use | ${clientFacing.length} |`);
  lines.push(`| Contacts on record | ${org.contacts.length} (${org.contacts.filter((c) => c.verificationStatus === 'verified').length} verified) |`);
  lines.push('');

  // --- What was found -------------------------------------------------------
  lines.push('## What the audit found');
  lines.push('');
  if (sorted.length === 0) {
    lines.push('No findings were produced. Either the site is in good order, or the audit could not reach it.');
  } else {
    for (const severity of ['critical', 'high', 'medium', 'low', 'informational']) {
      const group = sorted.filter((f) => f.severity === severity);
      if (group.length === 0) continue;
      lines.push(`### ${severity.charAt(0).toUpperCase() + severity.slice(1)} (${group.length})`);
      lines.push('');
      for (const f of group) {
        lines.push(`- **${f.reference}** — ${f.observation_text}`);
        lines.push(
          `  - status: ${statusLabel(f)} · confidence: ${f.confidence} · observed ${f.observedAt.toISOString().slice(0, 10)}`,
        );
        if (f.evidenceUrl) lines.push(`  - evidence: ${f.evidenceUrl}`);
        lines.push(`  - recommend: ${f.recommendation}`);
      }
      lines.push('');
    }
  }

  // --- Social ---------------------------------------------------------------
  lines.push('## Social and local presence');
  lines.push('');
  if (org.profiles.length === 0) {
    lines.push(
      'No social or Google Business profiles are on record. The audit records any profile the ' +
        "website links to; finding none means the site does not link to any.",
    );
  } else {
    lines.push(
      `${org.profiles.length} profile(s) recorded, discovered from links published on the ` +
        'organisation’s own website:',
    );
    lines.push('');
    for (const p of org.profiles) {
      const reviewed = p.lastCheckedAt
        ? `reviewed ${p.lastCheckedAt.toISOString().slice(0, 10)}`
        : '**not yet reviewed**';
      lines.push(
        `- ${PLATFORM_LABELS[p.platform as Platform] ?? p.platform}: ${p.url} — ${reviewed}`,
      );
    }
    lines.push('');
    lines.push(
      'Profile quality — completeness, posting frequency, branding, response paths — is not ' +
        'read automatically. These platforms do not permit it without an authorised API token, ' +
        'so an analyst completes the structured checklist on each profile.',
    );
  }
  lines.push('');

  // --- What could not be checked -------------------------------------------
  lines.push('## What could not be checked automatically');
  lines.push('');
  if (unverifiable.length === 0) {
    lines.push('Every selected check completed.');
  } else {
    lines.push(
      `${unverifiable.length} check(s) could not be completed. These produced **no findings** — ` +
        'an unverifiable check is never turned into a claim:',
    );
    lines.push('');
    for (const o of unverifiable.slice(0, 12)) {
      lines.push(`- \`${o.checkCode}\` — ${o.reason ?? 'no reason recorded'}`);
    }
  }
  lines.push('');

  // --- Next steps -----------------------------------------------------------
  const nextSteps: string[] = [];
  if (awaiting.length > 0) {
    nextSteps.push(
      `Review ${awaiting.length} finding(s) and mark the ones that hold as client-facing.`,
    );
  }
  if (stale.length > 0) {
    nextSteps.push(`Re-check ${stale.length} verified finding(s) that are now outside the freshness window.`);
  }
  if (org.profiles.some((p) => !p.lastCheckedAt)) {
    nextSteps.push(
      `Complete the social review for ${org.profiles.filter((p) => !p.lastCheckedAt).length} profile(s).`,
    );
  }
  if (org.contacts.length === 0) {
    nextSteps.push('Add a contact, with the source URL where the details were published.');
  } else if (!org.contacts.some((c) => c.verificationStatus === 'verified')) {
    nextSteps.push('Verify at least one contact before any outreach.');
  }
  if (clientFacing.length > 0) {
    nextSteps.push(`Generate the client-facing audit report from ${clientFacing.length} approved finding(s).`);
  }
  if (nextSteps.length === 0) nextSteps.push('Nothing outstanding.');

  lines.push('## Next steps');
  lines.push('');
  nextSteps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  lines.push('');

  return {
    organizationId: org.id,
    organizationName: org.brandName ?? org.legalName,
    website: org.website,
    generatedAt: new Date().toISOString(),
    markdown: lines.join('\n'),
    stats: {
      totalFindings: org.findings.length,
      verified: verified.length,
      awaitingReview: awaiting.length,
      clientFacing: clientFacing.length,
      stale: stale.length,
      bySeverity,
      socialProfiles: org.profiles.length,
      unverifiableChecks: unverifiable.length,
    },
    readyForClientReport: clientFacing.length > 0,
    nextSteps,
  };
}
