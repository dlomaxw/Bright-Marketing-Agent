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
      // Not a warning any more. A proposal with no figures is the normal case
      // here: the fee depends on the scope the client settles on, so it is
      // agreed in conversation rather than quoted from a list.
      warnings: result.pricingRequired
        ? ['This proposal carries the scope and no figures. Fees are agreed with the client once the scope is. To quote fixed prices instead, set every line fee and switch the proposal to fixed pricing.']
        : [],
    },
    201,
  );
});
