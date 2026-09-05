import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, body, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { generateProposal } from '@/server/proposals/build';

const schema = z.object({
  reportId: z.string().nullable().optional(),
  serviceCodes: z.array(z.string()).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('proposal.create');
  const input = await body(req, schema);
  const result = await generateProposal({
    organizationId: id,
    reportId: input.reportId ?? null,
    serviceCodes: input.serviceCodes,
    actorId: user.id,
  });
  return ok(
    {
      ...result,
      warnings: result.pricingRequired
        ? ['One or more service lines have no price. An authorised user must set every fee before this proposal can be submitted for approval.']
        : [],
    },
    201,
  );
});
