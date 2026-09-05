import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiHandler, body, notFound, ok, badRequest } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { domainKey, nameKey, normalizeUrl } from '@/lib/normalize';
import { changedFields, logActivity } from '@/server/activity';
import { zPipelineStage, zSector } from '@/lib/enums';
import { recomputeScores } from '@/server/scoring/recompute';

const patchSchema = z.object({
  legalName: z.string().min(2).max(200).optional(),
  brandName: z.string().max(200).nullable().optional(),
  industry: z.string().max(120).nullable().optional(),
  country: z.string().max(80).optional(),
  city: z.string().max(120).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  sector: zSector.optional(),
  stage: zPipelineStage.optional(),
  ownerId: z.string().nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  notes: z.string().max(8000).nullable().optional(),
  opportunityValue: z.number().nonnegative().nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  currency: z.enum(['UGX', 'USD']).optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  wonReason: z.string().max(500).nullable().optional(),
  lostReason: z.string().max(500).nullable().optional(),
  reason: z.string().max(500).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const input = await body(req, patchSchema);

  // Stage-only edits are a different permission from full record edits, so a
  // sales user can advance a lead without holding org.update.
  const stageOnly =
    Object.keys(input).filter((k) => k !== 'reason').length === 1 && input.stage !== undefined;
  const user = await requirePermission(stageOnly ? 'pipeline.update_stage' : 'org.update');

  const existing = await db.organization.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw notFound('Organization');

  const data: Record<string, unknown> = {};
  if (input.legalName !== undefined) {
    data.legalName = input.legalName;
    data.nameKey = nameKey(input.legalName);
  }
  if (input.website !== undefined) {
    if (input.website === null || input.website === '') {
      data.website = null;
      data.domainKey = null;
    } else {
      const normalized = normalizeUrl(input.website);
      if (!normalized) throw badRequest(`"${input.website}" is not a usable web address.`);
      data.website = normalized;
      data.domainKey = domainKey(normalized);
    }
  }
  for (const key of [
    'brandName',
    'industry',
    'country',
    'city',
    'sector',
    'stage',
    'ownerId',
    'notes',
    'opportunityValue',
    'probability',
    'currency',
    'wonReason',
    'lostReason',
  ] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  if (input.tags !== undefined) data.tagsJson = JSON.stringify(input.tags);
  if (input.nextFollowUpAt !== undefined) {
    data.nextFollowUpAt = input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null;
  }
  if (input.stage === 'won' || input.stage === 'lost') data.closedAt = new Date();

  const diff = changedFields(existing as unknown as Record<string, unknown>, data);
  if (!diff) return ok({ id, changed: false });

  await db.organization.update({ where: { id }, data });

  await logActivity({
    organizationId: id,
    actorId: user.id,
    action: input.stage !== undefined && stageOnly ? 'pipeline.stage_changed' : 'org.updated',
    entityType: 'organization',
    entityId: id,
    previousValue: diff.previous,
    newValue: diff.next,
    reason: input.reason ?? null,
  });

  // Value, sector and contactability all feed the score.
  if (
    input.opportunityValue !== undefined ||
    input.sector !== undefined ||
    input.website !== undefined
  ) {
    await recomputeScores(id);
  }

  return ok({ id, changed: true });
});

export const DELETE = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('org.delete');
  const existing = await db.organization.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw notFound('Organization');

  await db.organization.update({ where: { id }, data: { deletedAt: new Date() } });
  await logActivity({
    organizationId: id,
    actorId: user.id,
    action: 'org.deleted',
    entityType: 'organization',
    entityId: id,
    previousValue: { legalName: existing.legalName },
    reason: 'Soft delete. Evidence and activity history are retained.',
  });

  return ok({ id, deleted: true });
});
