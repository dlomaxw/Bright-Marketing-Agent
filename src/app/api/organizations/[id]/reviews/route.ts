import type { NextRequest } from 'next/server';
import { apiHandler, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { runReviewAudit } from '@/server/leads/review-audit';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Deep review and audience pass: Google reviews, YouTube channel statistics,
 * and what each platform will not let us read.
 */
export const POST = apiHandler<Ctx>(async (_req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('audit.run');
  const result = await runReviewAudit(id, user.id);

  return ok({
    organizationId: result.organizationId,
    reviews: result.reviews,
    audiences: result.audiences,
    serviceVisibility: result.serviceVisibility,
    findingsCreated: result.findingsCreated,
    // Named plainly, so the UI shows what a person still has to do by hand.
    manualReviewNeeded: result.manualReviewNeeded,
  });
});
