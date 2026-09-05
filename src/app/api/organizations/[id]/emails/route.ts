import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, body, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { createEmailDraft } from '@/server/emails/draft';

const schema = z.object({
  contactId: z.string().nullable().optional(),
  findingIds: z.array(z.string()).max(2).optional(),
  reportId: z.string().nullable().optional(),
  proposalId: z.string().nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('email.draft');
  const input = await body(req, schema);
  const result = await createEmailDraft({
    organizationId: id,
    contactId: input.contactId ?? null,
    findingIds: input.findingIds,
    reportId: input.reportId ?? null,
    proposalId: input.proposalId ?? null,
    user,
  });
  return ok(result, 201);
});
