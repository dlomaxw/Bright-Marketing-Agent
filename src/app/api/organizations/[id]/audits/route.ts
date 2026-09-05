import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, badRequest, body, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { zCheckGroup } from '@/lib/enums';
import { createAuditRun, drainQueue } from '@/server/audit/runner';
import { isProd } from '@/lib/env';

const schema = z.object({
  groups: z.array(zCheckGroup).min(1, 'Select at least one check group.'),
  targetUrl: z.string().optional().nullable(),
});

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('audit.run');
  const { groups, targetUrl } = await body(req, schema);

  let run;
  try {
    run = await createAuditRun({
      organizationId: id,
      groups,
      requestedById: user.id,
      targetUrl,
    });
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : 'The audit could not be started.');
  }

  // In development a single `npm run dev` should be enough to see results, so
  // the queue is drained in the background here. In production the dedicated
  // worker process owns this (see docs/DEPLOYMENT.md).
  if (!isProd) {
    void drainQueue(20).catch((err) => {
      console.error(JSON.stringify({ level: 'error', event: 'worker.inline_failed', err: String(err) }));
    });
  }

  return ok({ id: run.id, status: 'queued' }, 202);
});
