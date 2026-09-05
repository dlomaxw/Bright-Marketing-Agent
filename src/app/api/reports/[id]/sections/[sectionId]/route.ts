import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiHandler, badRequest, body, notFound, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { logActivity } from '@/server/activity';

const schema = z.object({
  body: z.string().max(60_000).optional(),
  heading: z.string().max(200).optional(),
  included: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string; sectionId: string }> };

export const PATCH = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id, sectionId } = await ctx.params;
  const user = await requirePermission('report.edit');
  const input = await body(req, schema);

  const section = await db.reportSection.findUnique({
    where: { id: sectionId },
    include: { report: true },
  });
  if (!section || section.reportId !== id) throw notFound('Report section');

  // An approved report is the record of what was signed off. Editing it must
  // create a new version rather than change history.
  if (['approved', 'superseded'].includes(section.report.status)) {
    throw badRequest(
      `This report is ${section.report.status} and cannot be edited. Generate a new version to make changes.`,
    );
  }

  const data: Record<string, unknown> = {};
  if (input.body !== undefined) {
    data.body = input.body;
    data.editedByHuman = true;
  }
  if (input.heading !== undefined) data.heading = input.heading;
  if (input.included !== undefined) data.included = input.included;

  if (Object.keys(data).length === 0) return ok({ id: sectionId, changed: false });

  await db.reportSection.update({ where: { id: sectionId }, data });

  await logActivity({
    organizationId: section.report.organizationId,
    actorId: user.id,
    action: 'report.section_edited',
    entityType: 'report_section',
    entityId: sectionId,
    previousValue: { body: section.body.slice(0, 500), included: section.included },
    newValue: {
      body: typeof data.body === 'string' ? data.body.slice(0, 500) : undefined,
      included: data.included,
    },
    metadata: { reportId: id, sectionKey: section.key },
  });

  return ok({ id: sectionId, changed: true });
});
