import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, badRequest, notFound } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { parseStringArray } from '@/lib/json';
import { renderDocx } from '@/documents/docx';
import { renderPdf } from '@/documents/pdf';
import { loadFindingFigures } from '@/documents/figures';
import { logActivity } from '@/server/activity';
import { PHASE_LABELS } from '@/lib/enums';
import { BRAND } from '@/config/brand';

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('proposal.export');
  const format = req.nextUrl.searchParams.get('format') ?? 'pdf';
  if (format !== 'pdf' && format !== 'docx') throw badRequest('Format must be pdf or docx.');

  const proposal = await db.proposal.findUnique({
    where: { id },
    include: { organization: true, items: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!proposal || proposal.deletedAt) throw notFound('Proposal');

  const cur = proposal.currency;
  const fmt = (n: number) => `${cur} ${n.toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;

  /**
   * Two ways to present the money, and the document must not mix them.
   *
   * Where the fee depends on the scope the client settles on, printing a table
   * of "UGX 0" against every line is not neutral — it reads as a quotation with
   * mistakes in it, and a client could reasonably ask to be held to it. The
   * honest version says what is being scoped and that the fee follows the
   * scope.
   *
   * The work itself is still itemised either way. What changes is whether a
   * number appears beside it.
   */
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
      return [`### ${i.name}`, i.description ?? '', ...list.map((d) => `- ${d}`)].filter(Boolean).join('\n');
    })
    .join('\n\n');

  const sections = [
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
      // Repeated at the end as well as the cover: a proposal is read, put down,
      // and picked up again by someone who needs to reply to it.
      heading: 'About us',
      body: [
        `**${BRAND.companyName}** — ${BRAND.tagline}`,
        '',
        BRAND.address,
        `Telephone: ${BRAND.phones.join(' · ')}`,
        `Email: ${BRAND.email}`,
        `Web: ${BRAND.websites.join(' · ')}`,
      ].join('\n'),
    },
  ].filter((s) => s.body.trim().length > 0);

  const meta = {
    title: 'Proposal',
    organization: proposal.organization.brandName ?? proposal.organization.legalName,
    version: proposal.version,
    status: proposal.status,
    preparedBy: user.name,
    date: proposal.createdAt,
  };

  /**
   * The screenshots belong with "Client situation and verified opportunity" —
   * the section that says what we observed. A proposal asks a business to
   * spend money on the strength of that observation, so showing the page it
   * was made about is the difference between an assertion and a case.
   *
   * Where nothing could be captured the section renders unchanged. Nothing is
   * drawn to fill the space.
   */
  const figures = await loadFindingFigures(proposal.organizationId);
  if (figures.length > 0 && sections[0]) {
    (sections[0] as { figures?: typeof figures }).figures = figures;
  }

  const buffer = format === 'docx' ? await renderDocx(meta, sections) : await renderPdf(meta, sections);

  await logActivity({
    organizationId: proposal.organizationId,
    actorId: user.id,
    action: 'proposal.exported',
    entityType: 'proposal',
    entityId: proposal.id,
    newValue: { format, version: proposal.version },
  });

  const safeName = meta.organization.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type':
        format === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/pdf',
      'content-disposition': `attachment; filename="proposal-${safeName}-v${proposal.version}.${format}"`,
      'cache-control': 'no-store',
    },
  });
});
