import { db } from '@/lib/db';
import { parseStringArray } from '@/lib/json';
import { PHASE_LABELS } from '@/lib/enums';
import { BRAND } from '@/config/brand';
import { renderDocx, type DocumentMeta, type DocumentSection } from './docx';
import { renderPdf } from './pdf';
import { loadFindingFigures } from './figures';

/**
 * Builds the client-facing report and proposal documents.
 *
 * Extracted from the two export routes so the same document can be produced
 * outside a request. Outreach needs it: the send gate said "Attaching approved
 * report v2 and proposal v1" while the send path had no attachment support at
 * all, so a prospect received a message referring to an audit that was not
 * enclosed. A gate that promises something the code cannot do is worse than no
 * gate, because it is believed.
 *
 * One builder, so an attachment is byte-for-byte the document someone
 * downloaded and approved — not a second rendering that could drift from it.
 */

export interface BuiltDocument {
  meta: DocumentMeta;
  sections: DocumentSection[];
  filename: string;
}

export async function buildReportDocument(
  reportId: string,
  preparedByName?: string,
): Promise<BuiltDocument | null> {
  const report = await db.report.findUnique({
    where: { id: reportId },
    include: { organization: true, sections: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!report || report.deletedAt) return null;

  const preparedBy =
    preparedByName ??
    (report.preparedBy
      ? ((await db.user.findUnique({ where: { id: report.preparedBy } }))?.name ?? BRAND.companyName)
      : BRAND.companyName);

  const organization = report.organization.brandName ?? report.organization.legalName;

  const sections: DocumentSection[] = report.sections
    .filter((s) => s.included && s.key !== 'cover')
    .map((s) => ({ heading: s.heading, body: s.body }));

  // Screenshots sit with the findings section, where the claims they support
  // are made.
  const figures = await loadFindingFigures(report.organizationId);
  if (figures.length > 0) {
    const target =
      sections.find((s) => /finding|observ|what we found/i.test(s.heading)) ?? sections[0];
    if (target) target.figures = figures;
  }

  return {
    meta: {
      title: 'Digital presence audit',
      organization,
      version: report.version,
      status: report.status,
      preparedBy,
      date: report.createdAt,
    },
    sections,
    filename: `audit-report-${safeName(organization)}-v${report.version}`,
  };
}

export async function buildProposalDocument(
  proposalId: string,
  preparedByName?: string,
): Promise<BuiltDocument | null> {
  const proposal = await db.proposal.findUnique({
    where: { id: proposalId },
    include: { organization: true, items: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!proposal || proposal.deletedAt) return null;

  const cur = proposal.currency;
  const fmt = (n: number) => `${cur} ${n.toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;
  const priceOnDiscussion = proposal.pricingBasis !== 'fixed';

  const investmentRows = priceOnDiscussion
    ? [
        '| Item | Phase | Quantity |',
        '| --- | --- | --- |',
        ...proposal.items.map(
          (i) => `| ${i.name} | ${PHASE_LABELS[i.phase] ?? i.phase} | ${i.quantity} |`,
        ),
        '',
        `Fees are agreed against the scope above rather than quoted from a list. ${BRAND.companyName} will confirm the investment for each phase once the scope, timing and priorities are settled with you — so you pay for the work you actually want, in the order you want it.`,
        '',
        'This document is a scope of work, not a quotation, and no figure in it is binding on either party.',
      ].join('\n')
    : [
        '| Item | Phase | Qty | Unit fee | Line total |',
        '| --- | --- | --- | --- | --- |',
        ...proposal.items.map(
          (i) =>
            `| ${i.name} | ${PHASE_LABELS[i.phase] ?? i.phase} | ${i.quantity} | ${fmt(i.unitFee)} | ${fmt(i.lineTotal)} |`,
        ),
        `| **Subtotal** |  |  |  | **${fmt(proposal.subtotal)}** |`,
        ...(proposal.discount > 0 ? [`| Discount |  |  |  | -${fmt(proposal.discount)} |`] : []),
        ...(proposal.taxRate > 0
          ? [`| Tax (${Math.round(proposal.taxRate * 100)}%) |  |  |  | ${fmt(proposal.taxAmount)} |`]
          : []),
        `| **Total** |  |  |  | **${fmt(proposal.total)}** |`,
      ].join('\n');

  const deliverablesBlock = proposal.items
    .map((i) => {
      const list = parseStringArray(i.deliverablesJson);
      return [`### ${i.name}`, i.description ?? '', ...list.map((d) => `- ${d}`)]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  const sections: DocumentSection[] = [
    { heading: 'Client situation and verified opportunity', body: proposal.situation ?? '' },
    { heading: 'Project objectives', body: proposal.objectives ?? '' },
    { heading: 'Recommended solution', body: proposal.solution ?? '' },
    { heading: 'Scope of work', body: proposal.scope ?? '' },
    { heading: 'Deliverables', body: deliverablesBlock || (proposal.deliverables ?? '') },
    { heading: 'Implementation phases', body: proposal.phases ?? '' },
    { heading: 'Timeline', body: proposal.timeline ?? '' },
    { heading: 'Client responsibilities', body: proposal.clientResponsibilities ?? '' },
    { heading: 'Required assets and access', body: proposal.requiredAssets ?? '' },
    { heading: priceOnDiscussion ? 'Investment and scope' : 'Investment', body: investmentRows },
    {
      heading: 'Payment schedule',
      body:
        proposal.paymentSchedule ??
        (priceOnDiscussion
          ? 'Agreed with the investment, once the scope is confirmed.'
          : 'To be confirmed.'),
    },
    { heading: 'Assumptions', body: proposal.assumptions ?? 'To be confirmed.' },
    { heading: 'Exclusions', body: proposal.exclusions ?? 'To be confirmed.' },
    { heading: 'Change control', body: proposal.changeControl ?? 'To be confirmed.' },
    {
      heading: 'Proposal validity',
      body: proposal.validUntil
        ? `This proposal is valid until ${proposal.validUntil.toISOString().slice(0, 10)}.`
        : 'Validity period to be confirmed.',
    },
    { heading: 'Acceptance', body: proposal.acceptanceTerms ?? 'Signature, name, position and date.' },
    { heading: 'Next steps', body: proposal.nextSteps ?? '' },
    {
      heading: 'About us',
      body: [
        `**${BRAND.companyName}** — ${BRAND.tagline}`,
        '',
        BRAND.address,
        `Telephone: ${BRAND.phones.join(' · ')}`,
        `Email: ${BRAND.email} · ${BRAND.emailSending}`,
        `Web: ${BRAND.websites.join(' · ')}`,
      ].join('\n'),
    },
  ].filter((s) => s.body.trim().length > 0);

  const figures = await loadFindingFigures(proposal.organizationId);
  if (figures.length > 0 && sections[0]) sections[0].figures = figures;

  const organization = proposal.organization.brandName ?? proposal.organization.legalName;

  return {
    meta: {
      title: 'Proposal',
      organization,
      version: proposal.version,
      status: proposal.status,
      preparedBy: preparedByName ?? BRAND.companyName,
      date: proposal.createdAt,
    },
    sections,
    filename: `proposal-${safeName(organization)}-v${proposal.version}`,
  };
}

export async function renderDocument(
  doc: BuiltDocument,
  format: 'pdf' | 'docx',
): Promise<Buffer> {
  return format === 'docx' ? renderDocx(doc.meta, doc.sections) : renderPdf(doc.meta, doc.sections);
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}
