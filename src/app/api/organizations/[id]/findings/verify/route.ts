import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiHandler, badRequest, body, notFound, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { can } from '@/server/auth/permissions';
import { logActivity } from '@/server/activity';
import { recomputeScores } from '@/server/scoring/recompute';

/**
 * Verifies every outstanding finding for ONE organization, as a single human
 * decision.
 *
 * Why this exists. Reviewing findings one at a time does not scale: an audit of
 * 1,500 companies produces thousands, and a gate nobody can realistically pass
 * through stops being a safeguard and becomes the reason the work never ships.
 *
 * What has NOT changed is who decides. This endpoint requires the same
 * `finding.verify` permission as reviewing one at a time, records the same
 * reviewer against every row, and is reachable only from a session. The agent
 * cannot call it. What it removes is the clicking, not the accountability:
 * a person still reads the organization's findings and takes responsibility for
 * the set, and the activity log names them and counts what they approved.
 *
 * Two things it deliberately will not do:
 *
 *   - It will not touch a finding whose observation was `unverifiable`. Those
 *     record that a check could not be completed, not that something is wrong,
 *     and no amount of approving makes them into evidence.
 *   - It will not resurrect a dismissed finding. Someone already decided that
 *     one, and a bulk action must not quietly overturn a specific judgement.
 */

const schema = z.object({
  /** Findings the reviewer chose to leave out. Approving is not all-or-nothing. */
  excludeFindingIds: z.array(z.string()).max(500).default([]),
  /** Whether the approved findings also become client-facing. */
  clientVisible: z.boolean().default(true),
  reason: z.string().max(500).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id: organizationId } = await ctx.params;
  const user = await requirePermission('finding.verify');
  const input = await body(req, schema);

  if (input.clientVisible && !can(user.role, 'finding.set_visibility')) {
    throw badRequest(
      'Your role can verify findings but not mark them client-facing. Approve without client visibility, or ask someone who can.',
    );
  }

  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, legalName: true, deletedAt: true },
  });
  if (!org || org.deletedAt) throw notFound('Organization');

  const excluded = new Set(input.excludeFindingIds);

  const candidates = await db.finding.findMany({
    where: {
      organizationId,
      deletedAt: null,
      verificationStatus: { in: ['auto_detected', 'needs_review'] },
    },
    select: { id: true, reference: true, severity: true, confidence: true },
  });

  const toVerify = candidates.filter((f) => !excluded.has(f.id));
  if (toVerify.length === 0) {
    return ok({
      organizationId,
      verified: 0,
      skipped: candidates.length,
      message: 'Nothing to verify: every finding has already been reviewed or was excluded.',
    });
  }

  const reviewedAt = new Date();

  /**
   * Updated one at a time on purpose.
   *
   * A single updateMany over a filter is how an approval intended for one
   * organization becomes an approval of everything — the filter is written
   * once and never seen again. Naming each id makes the set explicit, bounds
   * the blast radius to the rows counted above, and keeps the row count in the
   * activity log honest.
   */
  let verified = 0;
  for (const finding of toVerify) {
    await db.finding.update({
      where: { id: finding.id },
      data: {
        verificationStatus: 'manually_verified',
        clientVisible: input.clientVisible,
        reviewerId: user.id,
        reviewedAt,
      },
    });
    verified += 1;
  }

  await logActivity({
    organizationId,
    actorId: user.id,
    action: 'finding.bulk_verified',
    entityType: 'organization',
    entityId: organizationId,
    newValue: {
      verified,
      excluded: excluded.size,
      clientVisible: input.clientVisible,
      references: toVerify.slice(0, 50).map((f) => f.reference),
    },
    reason:
      input.reason?.trim() ||
      `Reviewed and approved ${verified} finding(s) for ${org.legalName} in one decision.`,
  });

  // Evidence confidence is derived from verification state, so it changes here.
  await recomputeScores(organizationId);

  return ok({
    organizationId,
    verified,
    excluded: excluded.size,
    clientVisible: input.clientVisible,
    reviewedBy: user.name,
  });
});
