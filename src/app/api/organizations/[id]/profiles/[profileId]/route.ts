import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiHandler, badRequest, body, notFound, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { logActivity } from '@/server/activity';
import { stringify } from '@/lib/json';
import { checklistFor } from '@/audit/checks/social';
import type { Platform } from '@/lib/enums';

/**
 * Saves the manual social / Google Business review for one profile.
 *
 * The checklist is the only route by which a human observation about a social
 * profile enters the system. Nothing here is inferred: an item left at
 * `unknown` stays unknown, because "not checked" and "checked and absent" lead
 * to different recommendations and must never be collapsed.
 *
 * Note what this endpoint does *not* write: `followers`. Follower counts are
 * only ever set from an authorized API (see `review-audit.ts`), never typed in
 * from a page a reviewer happened to be looking at.
 */

const answerSchema = z.union([
  z.enum(['yes', 'no', 'unknown']),
  z.string().max(1000),
]);

const schema = z.object({
  answers: z.record(z.string(), answerSchema),
  notes: z.string().max(2000).optional(),
});

type Ctx = { params: Promise<{ id: string; profileId: string }> };

export const PATCH = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id: organizationId, profileId } = await ctx.params;
  const user = await requirePermission('org.update');

  const profile = await db.platformProfile.findUnique({ where: { id: profileId } });
  if (!profile || profile.organizationId !== organizationId) throw notFound('Platform profile');

  const input = await body(req, schema);

  // Only keys the checklist actually defines are stored, so a stale or crafted
  // form cannot widen the record.
  const allowed = new Set(checklistFor(profile.platform as Platform).map((item) => item.key));
  const unknownKeys = Object.keys(input.answers).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw badRequest(`Unrecognised checklist item(s): ${unknownKeys.join(', ')}.`);
  }

  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.answers)) {
    const trimmed = String(value).trim();
    if (trimmed !== '') answers[key] = trimmed;
  }

  // The reviewer records the date of the most recent public post as part of the
  // checklist; promote it to its own column so freshness rules can use it.
  const lastPostRaw = answers.last_post_at;
  const lastPostAt = lastPostRaw && !Number.isNaN(Date.parse(lastPostRaw)) ? new Date(lastPostRaw) : null;

  const updated = await db.platformProfile.update({
    where: { id: profileId },
    data: {
      checklistJson: stringify(answers),
      notes: input.notes?.trim() || null,
      lastPostAt,
      lastCheckedAt: new Date(),
      checkedBy: user.id,
      verificationStatus: 'reviewed',
    },
  });

  await logActivity({
    organizationId,
    actorId: user.id,
    action: 'profile.reviewed',
    entityType: 'platform_profile',
    entityId: profileId,
    newValue: {
      platform: profile.platform,
      answered: Object.keys(answers).length,
      total: allowed.size,
    },
    reason: 'Manual platform review completed.',
  });

  return ok({ profile: { id: updated.id, lastCheckedAt: updated.lastCheckedAt } });
});
