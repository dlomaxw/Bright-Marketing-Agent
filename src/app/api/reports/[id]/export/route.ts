import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler, badRequest, notFound } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { renderDocx } from '@/documents/docx';
import { renderPdf } from '@/documents/pdf';
import { logActivity } from '@/server/activity';

type Ctx = { params: Promise<{ id: string }> };

export const GET = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('report.export');
  const format = req.nextUrl.searchParams.get('format') ?? 'pdf';
  if (format !== 'pdf' && format !== 'docx') throw badRequest('Format must be pdf or docx.');

  const report = await db.report.findUnique({
    where: { id },
    include: {
      organization: true,
      sections: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!report || report.deletedAt) throw notFound('Report');

  const preparedBy = report.preparedBy
    ? ((await db.user.findUnique({ where: { id: report.preparedBy } }))?.name ?? 'Bright Thoughts Services')
    : 'Bright Thoughts Services';

  const meta = {
    title: 'Digital presence audit',
    organization: report.organization.brandName ?? report.organization.legalName,
    version: report.version,
    status: report.status,
    preparedBy,
    date: report.createdAt,
  };
  const sections = report.sections
    .filter((s) => s.included && s.key !== 'cover')
    .map((s) => ({ heading: s.heading, body: s.body }));

  const buffer = format === 'docx' ? await renderDocx(meta, sections) : await renderPdf(meta, sections);

  await logActivity({
    organizationId: report.organizationId,
    actorId: user.id,
    action: 'report.exported',
    entityType: 'report',
    entityId: report.id,
    newValue: { format, version: report.version },
  });

  const safeName = meta.organization.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type':
        format === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/pdf',
      'content-disposition': `attachment; filename="audit-${safeName}-v${report.version}.${format}"`,
      'cache-control': 'no-store',
    },
  });
});
