import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, body, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { researchUgandaLeads } from '@/server/leads/uganda-research';

const schema = z.object({
  query: z.string().max(200).optional(),
  industry: z.string().max(120).optional(),
  maxLeads: z.coerce.number().int().min(1).max(10).default(3),
  /**
   * Analyst-supplied domains. Strongly preferred over model discovery: these
   * are confirmed to exist by the person adding them, so nothing is guessed.
   */
  candidateDomains: z.array(z.string().max(300)).max(10).optional(),
});

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requirePermission('org.create');
  const input = await body(req, schema);

  const outcome = await researchUgandaLeads({
    query: input.query,
    industry: input.industry,
    maxLeads: input.maxLeads,
    candidateDomains: input.candidateDomains,
    actorId: user.id,
  });

  return ok({
    success: true,
    query: outcome.query,
    industry: outcome.industry,
    candidatesProposed: outcome.candidatesProposed,
    candidatesReachable: outcome.candidatesReachable,
    discarded: outcome.candidatesDiscarded,
    results: outcome.results,
    // Made explicit in the response so the UI cannot present unconfirmed
    // discovery as though it were established fact.
    candidatesAreUnconfirmed: outcome.candidatesAreUnconfirmed,
    nextStep: outcome.nextStep,
  });
});
