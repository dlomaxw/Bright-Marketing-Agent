import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, badRequest, notFound } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { parseStringArray } from '@/lib/json';
import { renderDocx } from '@/documents/docx';
import { renderPdf } from '@/documents/pdf';
import { logActivity } from '@/server/activity';
import { PHASE_LABELS } from '@/lib/enums';

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

  const investmentRows = [
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
    { heading: 'Investment', body: investmentRows },
    { heading: 'Payment schedule', body: proposal.paymentSchedule ?? 'To be confirmed.' },
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
  ].filter((s) => s.body.trim().length > 0);

  const meta = {
    title: 'Proposal',
    organization: proposal.organization.brandName ?? proposal.organization.legalName,
    version: proposal.version,
    status: proposal.status,
    preparedBy: user.name,
    date: proposal.createdAt,
  };

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
