import type { NextRequest } from 'next/server';
import { apiHandler, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { generateReport } from '@/server/reports/build';

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (_req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('report.create');
  const result = await generateReport({ organizationId: id, actorId: user.id });
  return ok(result, 201);
});
