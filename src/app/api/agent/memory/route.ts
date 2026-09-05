import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, ok, query } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import {
  agentAllClients,
  agentClientSummary,
  agentClientTimeline,
  agentMemorySnapshot,
  agentOutreachHistory,
  agentPitchCandidates,
} from '@/server/agent/memory';

const schema = z.object({
  scope: z.enum(['snapshot', 'clients', 'client', 'outreach', 'timeline', 'pitch', 'all']).default('snapshot'),
  organizationId: z.string().optional(),
  outreachStatus: z.enum(['sent', 'unsent', 'awaiting_approval', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

/**
 * The assistant's recall endpoint. Read-only by construction — the memory
 * module exposes no writes — and gated on the same permissions as the screens
 * showing the same data, so the assistant can never reveal more than the signed
 * in user could see for themselves.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  await requirePermission('org.read');
  const params = query(req, schema);

  switch (params.scope) {
    case 'clients':
      return ok({ clients: await agentAllClients(params.limit) });

    case 'client': {
      if (!params.organizationId) return ok({ error: 'organizationId is required.' }, 400);
      const client = await agentClientSummary(params.organizationId);
      return client ? ok({ client }) : ok({ error: 'Organization not found.' }, 404);
    }

    case 'outreach':
      await requirePermission('email.draft');
      return ok({
        outreach: await agentOutreachHistory({
          organizationId: params.organizationId,
          status: params.outreachStatus,
          limit: params.limit,
        }),
      });

    case 'timeline': {
      if (!params.organizationId) return ok({ error: 'organizationId is required.' }, 400);
      await requirePermission('activity.read');
      return ok({ timeline: await agentClientTimeline(params.organizationId, params.limit) });
    }

    case 'pitch':
      return ok({ candidates: await agentPitchCandidates(params.limit) });

    case 'all':
      return ok({
        snapshot: await agentMemorySnapshot(),
        pitch: await agentPitchCandidates(5),
        outreach: await agentOutreachHistory({ limit: 10 }),
      });

    case 'snapshot':
    default:
      return ok({ snapshot: await agentMemorySnapshot() });
  }
});
