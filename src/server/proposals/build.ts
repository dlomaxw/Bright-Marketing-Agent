import { db } from '@/lib/db';
import { AppError } from '@/lib/api';
import { parseStringArray } from '@/lib/json';
import { logActivity } from '@/server/activity';
import { getSetting } from '@/server/settings';
import { recommendAiServices, recommendPlatform } from './platform-recommendation';
import type { Confidence, Severity } from '@/lib/enums';

/**
 * Proposal generation.
 *
 * Two rules shape this module:
 *  1. Every proposal line must be traceable to the verified findings that
 *     justify it (`sourceFindingIdsJson`), so a client can be told exactly why
 *     a service is being recommended.
 *  2. No commercial field is ever populated automatically. Prices, discounts,
 *     tax, payment terms and legal text are left empty for an authorized human,
 *     and the AI provider is not given the ability to write them.
 */

export interface ProposalBuildOptions {
  organizationId: string;
  reportId?: string | null;
  actorId: string;
  /** Optional explicit selection; otherwise derived from the findings. */
  serviceCodes?: string[];
}

export async function generateProposal(
  options: ProposalBuildOptions,
): Promise<{ id: string; suggestedServices: string[]; pricingRequired: boolean }> {
  const org = await db.organization.findUnique({
    where: { id: options.organizationId },
    include: { findings: { where: { deletedAt: null } } },
  });
  if (!org) throw new AppError('Organization not found.', 404);

  const report = options.reportId
    ? await db.report.findUnique({
        where: { id: options.reportId },
        include: { findings: { include: { finding: true } } },
      })
    : await db.report.findFirst({
        where: { organizationId: org.id, status: 'approved' },
        orderBy: { version: 'desc' },
        include: { findings: { include: { finding: true } } },
      });

  // Only verified, client-visible findings may justify a proposal line.
  const justifying = report
    ? report.findings.filter((rf) => rf.included).map((rf) => rf.finding)
    : org.findings.filter((f) => f.verificationStatus === 'manually_verified' && f.clientVisible);

  if (justifying.length === 0) {
    throw new AppError(
      'A proposal must be built from verified findings. Verify at least one finding and mark it client-facing first.',
      409,
    );
  }

  // Map findings to service modules using the codes stored on each finding.
  const suggested = new Map<string, string[]>(); // serviceCode -> finding ids
  for (const f of justifying) {
    for (const code of parseStringArray(f.recommendedServiceCodes)) {
      const list = suggested.get(code) ?? [];
      list.push(f.id);
      suggested.set(code, list);
    }
  }
  /**
   * The platform recommendation. This is the strategic layer on top of the
   * finding-by-finding mapping: whether to rebuild on a platform we control,
   * modernise what is there, or leave it alone. It can and does return
   * "maintain" — recommending a rebuild the evidence does not support would be
   * the same error as inventing a finding.
   */
  const platform = recommendPlatform(
    justifying.map((f) => ({
      id: f.id,
      reference: f.reference,
      checkCode: f.checkCode,
      category: f.category,
      severity: f.severity as Severity,
      confidence: f.confidence as Confidence,
      observation: f.observation_text,
    })),
    { hasWebsite: !!org.website },
  );

  const aiOpportunities = recommendAiServices(
    justifying.map((f) => ({
      id: f.id,
      reference: f.reference,
      checkCode: f.checkCode,
      category: f.category,
      severity: f.severity as Severity,
      confidence: f.confidence as Confidence,
      observation: f.observation_text,
    })),
  );

  // The recommendation adds the services its verdict justifies. Findings that
  // triggered the verdict are attached, so every line still traces to evidence.
  const refToId = new Map(justifying.map((f) => [f.reference, f.id]));
  const verdictFindingIds = [
    ...new Set(platform.rationale.flatMap((r) => r.findingRefs)),
  ]
    .map((ref) => refToId.get(ref))
    .filter((id): id is string => !!id);

  for (const code of platform.serviceCodes) {
    if (!suggested.has(code)) suggested.set(code, verdictFindingIds);
  }
  for (const ai of aiOpportunities) {
    if (!suggested.has(ai.serviceCode)) {
      suggested.set(
        ai.serviceCode,
        ai.findingRefs.map((ref) => refToId.get(ref)).filter((id): id is string => !!id),
      );
    }
  }

  if (options.serviceCodes?.length) {
    for (const code of suggested.keys()) {
      if (!options.serviceCodes.includes(code)) suggested.delete(code);
    }
    for (const code of options.serviceCodes) {
      if (!suggested.has(code)) suggested.set(code, []);
    }
  }

  const modules = await db.serviceModule.findMany({
    where: { code: { in: [...suggested.keys()] }, active: true },
    include: { prices: { where: { active: true, currency: org.currency } } },
  });

  const latest = await db.proposal.findFirst({
    where: { organizationId: org.id },
    orderBy: { version: 'desc' },
  });
  const version = (latest?.version ?? 0) + 1;
  if (latest && latest.status !== 'superseded') {
    await db.proposal.update({ where: { id: latest.id }, data: { status: 'superseded' } });
  }

  const brand = await getSetting('brand.details');
  const orgName = org.brandName ?? org.legalName;

  const items = modules.map((m, index) => {
    const findingIds = suggested.get(m.code) ?? [];
    const price = m.prices[0];
    const unitFee = price?.amount ?? 0;
    return {
      serviceModuleId: m.id,
      name: m.name,
      description: m.summary,
      deliverablesJson: m.deliverablesJson,
      phase: m.defaultPhase,
      quantity: 1,
      unit: price?.unit ?? 'project',
      unitFee,
      lineTotal: unitFee,
      sourceFindingIdsJson: JSON.stringify(findingIds),
      sortOrder: index,
    };
  });

  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
  const pricingRequired = items.some((i) => i.unitFee === 0);

  const findingSummary = justifying
    .slice(0, 6)
    .map((f) => `- ${f.reference}: ${f.observation_text}`)
    .join('\n');

  const proposal = await db.proposal.create({
    data: {
      organizationId: org.id,
      reportId: report?.id ?? null,
      version,
      title: `Proposal for ${orgName}`,
      status: 'draft',
      currency: org.currency,

      situation: [
        `${brand.companyName} reviewed the public digital presence of ${orgName}${org.website ? ` at ${org.website}` : ''}.`,
        report ? `This proposal follows the audit report issued as version ${report.version}.` : '',
        '',
        'The verified observations behind this proposal are:',
        '',
        findingSummary,
      ]
        .filter(Boolean)
        .join('\n'),

      objectives: [
        'The objectives of this engagement are to:',
        '',
        '1. Correct the verified issues recorded in the audit.',
        '2. Give visitors a clear path from arrival to enquiry.',
        '3. Put measurement in place so the effect of the work can be seen.',
        '',
        'Success measures are agreed with the client before work begins and reported against monthly.',
      ].join('\n'),

      solution: [
        `## ${platform.headline}`,
        '',
        ...platform.rationale.flatMap((r) => [
          `${r.point}${r.findingRefs.length ? ` *(${r.findingRefs.join(', ')})*` : ''}`,
          '',
        ]),
        `*${platform.honestCaveat}*`,
        '',
        ...(aiOpportunities.length > 0
          ? [
              '## Where AI is worth adding',
              '',
              'Recommended only where the audit showed something it addresses. None of these is offered as a guarantee of a result.',
              '',
              ...aiOpportunities.flatMap((ai) => [
                `**${ai.name}** — ${ai.justification} *(${ai.findingRefs.join(', ')})*`,
                '',
              ]),
            ]
          : []),
        '## Service modules',
        '',
        `Each of the following was selected because it addresses a specific verified finding:`,
        '',
        ...items.map((i) => {
          const refs = JSON.parse(i.sourceFindingIdsJson) as string[];
          const refList = justifying
            .filter((f) => refs.includes(f.id))
            .map((f) => f.reference)
            .join(', ');
          return `- **${i.name}** — ${i.description}${refList ? ` *(addresses ${refList})*` : ''}`;
        }),
      ].join('\n'),

      scope: 'To be confirmed with the client during the discovery session.',
      deliverables: items.map((i) => `- ${i.name}`).join('\n'),
      phases: [...new Set(items.map((i) => i.phase))].sort().join(', '),
      timeline: 'To be confirmed once scope is agreed.',
      clientResponsibilities: [
        '- A named point of contact with authority to approve content and design.',
        '- Access to hosting, domain, CMS and analytics accounts, or an introduction to the parties who hold them.',
        '- Brand assets: logo files, brand colours and any existing style guidance.',
        '- Review and feedback within the agreed turnaround at each stage.',
      ].join('\n'),
      requiredAssets: [
        '- Domain registrar access',
        '- Hosting or server access',
        '- CMS administrator account',
        '- Google Analytics and Google Search Console access',
        '- Google Business Profile management access',
        '- Social media page administrator access',
      ].join('\n'),

      // Commercial fields intentionally left for an authorized human.
      subtotal,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      total: subtotal,
      paymentSchedule: null,
      assumptions: null,
      exclusions: null,
      changeControl: null,
      validUntil: null,
      acceptanceTerms: null,
      nextSteps:
        'Confirm the scope in a short discussion, agree the commercial terms, and schedule the discovery session.',
      generatedByAi: false,

      items: { create: items },
    },
  });

  await db.organization.update({
    where: { id: org.id },
    data: {
      stage: ['won', 'lost', 'nurture'].includes(org.stage) ? org.stage : 'proposal_ready',
    },
  });

  await logActivity({
    organizationId: org.id,
    actorId: options.actorId,
    action: 'proposal.generated',
    entityType: 'proposal',
    entityId: proposal.id,
    newValue: { version, modules: modules.map((m) => m.code), pricingRequired },
  });

  return {
    id: proposal.id,
    suggestedServices: modules.map((m) => m.code),
    pricingRequired,
  };
}

/** Recalculates the money fields after a human edits a line or the tax rate. */
export async function recalculateTotals(proposalId: string): Promise<void> {
  const proposal = await db.proposal.findUnique({
    where: { id: proposalId },
    include: { items: true },
  });
  if (!proposal) return;

  const subtotal = proposal.items.reduce((sum, i) => sum + i.quantity * i.unitFee, 0);
  const afterDiscount = Math.max(0, subtotal - proposal.discount);
  const taxAmount = Math.round(afterDiscount * proposal.taxRate * 100) / 100;

  await db.$transaction([
    ...proposal.items.map((i) =>
      db.proposalItem.update({
        where: { id: i.id },
        data: { lineTotal: Math.round(i.quantity * i.unitFee * 100) / 100 },
      }),
    ),
    db.proposal.update({
      where: { id: proposalId },
      data: {
        subtotal: Math.round(subtotal * 100) / 100,
        taxAmount,
        total: Math.round((afterDiscount + taxAmount) * 100) / 100,
      },
    }),
  ]);
}
