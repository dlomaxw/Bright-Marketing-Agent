import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, body, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { findBusinessesWithoutWebsites } from '@/server/leads/gbp-prospecting';

const schema = z.object({
  query: z.string().min(3).max(200),
  maxResults: z.coerce.number().int().min(1).max(20).default(20),
  dryRun: z.boolean().default(false),
  thresholds: z
    .object({
      minReviews: z.number().int().min(0).max(500).optional(),
      minRating: z.number().min(0).max(5).optional(),
      minPhotos: z.number().int().min(0).max(50).optional(),
    })
    .optional(),
});

/**
 * Finds businesses listed on Google that need what the agency sells.
 *
 * Every listing is put through the qualification gate before it can become a
 * prospect: it must look like an established trading business AND show a real
 * need. Listings that fail are returned with their reasons but are not written.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requirePermission('org.create');
  const input = await body(req, schema);

  const outcome = await findBusinessesWithoutWebsites({
    query: input.query,
    maxResults: input.maxResults,
    dryRun: input.dryRun,
    thresholds: input.thresholds,
    actorId: user.id,
  });

  return ok({
    configured: outcome.configured,
    query: outcome.query,
    searched: outcome.searched,
    qualified: outcome.qualified,
    needsManualReview: outcome.needsManualReview,
    rejected: outcome.rejected,
    created: outcome.created,
    alreadyKnown: outcome.alreadyKnown,
    message: outcome.message,
    businesses: outcome.businesses.map((b) => ({
      organizationId: b.organizationId,
      name: b.name,
      category: b.category,
      address: b.address,
      phone: b.phone,
      website: b.website,
      rating: b.rating,
      reviews: b.reviews,
      googleMapsUri: b.googleMapsUri,
      verdict: b.qualification.verdict,
      establishedScore: b.qualification.establishedScore,
      needScore: b.qualification.needScore,
      reasons: b.qualification.reasons,
      blockers: b.qualification.blockers,
      opportunity: b.qualification.opportunitySummary,
    })),
  });
});
