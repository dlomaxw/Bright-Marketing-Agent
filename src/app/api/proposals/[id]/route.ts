import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiHandler, badRequest, body, notFound, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { logActivity } from '@/server/activity';
import { recalculateTotals } from '@/server/proposals/build';
import { can } from '@/server/auth/permissions';

const narrative = z.string().max(20_000).nullable().optional();

const schema = z.object({
  situation: narrative,
  objectives: narrative,
  solution: narrative,
  scope: narrative,
  deliverables: narrative,
  phases: narrative,
  timeline: narrative,
  clientResponsibilities: narrative,
  requiredAssets: narrative,

  // Commercial fields — a separate permission, checked below.
  discount: z.number().min(0).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  validUntil: z.string().nullable().optional(),
  paymentSchedule: narrative,
  assumptions: narrative,
  exclusions: narrative,
  changeControl: narrative,
  acceptanceTerms: narrative,
  nextSteps: narrative,
  items: z
    .array(
      z.object({
        id: z.string(),
        quantity: z.number().min(0),
        unitFee: z.number().min(0),
        phase: z.string().max(40),
      }),
    )
    .optional(),
  confirmCommercials: z.boolean().default(false),
});

const COMMERCIAL_KEYS = [
  'discount', 'taxRate', 'validUntil', 'paymentSchedule', 'assumptions',
  'exclusions', 'changeControl', 'acceptanceTerms', 'nextSteps', 'items',
] as const;

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('proposal.edit');
  const input = await body(req, schema);

  const proposal = await db.proposal.findUnique({ where: { id }, include: { items: true } });
  if (!proposal || proposal.deletedAt) throw notFound('Proposal');

  if (['approved', 'superseded'].includes(proposal.status)) {
    throw badRequest(
      `This proposal is ${proposal.status} and cannot be edited. Generate a new version to make changes.`,
    );
  }

  const touchesCommercials =
    COMMERCIAL_KEYS.some((k) => input[k] !== undefined) || input.confirmCommercials;

  // Commercial authority is a separate grant. An auditor may write the narrative
  // but must not set a price (product documentation, pricing safeguard).
  if (touchesCommercials && !can(user.role, 'proposal.set_commercials')) {
    throw badRequest(
      'Your role can edit the proposal narrative but not the commercial terms. A sales or administrator user must set fees, tax and payment terms.',
    );
  }

  const data: Record<string, unknown> = {};
  for (const key of [
    'situation', 'objectives', 'solution', 'scope', 'deliverables', 'phases', 'timeline',
    'clientResponsibilities', 'requiredAssets',
  ] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }

  if (touchesCommercials) {
    for (const key of [
      'discount', 'taxRate', 'paymentSchedule', 'assumptions', 'exclusions',
      'changeControl', 'acceptanceTerms', 'nextSteps',
    ] as const) {
      if (input[key] !== undefined) data[key] = input[key];
    }
    if (input.validUntil !== undefined) {
      data.validUntil = input.validUntil ? new Date(input.validUntil) : null;
    }
  }

  // Editing after a rejection returns it to draft so it must be resubmitted.
  if (proposal.status === 'changes_requested' || proposal.status === 'pending_approval') {
    data.status = 'draft';
  }

  if (input.confirmCommercials) {
    const lines = input.items ?? proposal.items.map((i) => ({ id: i.id, unitFee: i.unitFee }));
    if (lines.some((l) => l.unitFee <= 0)) {
      throw badRequest('Every service line must have a fee before the commercial terms can be confirmed.');
    }
    data.commercialsSetBy = user.id;
    data.commercialsSetAt = new Date();
  }

  await db.$transaction([
    db.proposal.update({ where: { id }, data }),
    ...(input.items ?? []).map((line) =>
      db.proposalItem.update({
        where: { id: line.id },
        data: { quantity: line.quantity, unitFee: line.unitFee, phase: line.phase },
      }),
    ),
  ]);

  await recalculateTotals(id);

  await logActivity({
    organizationId: proposal.organizationId,
    actorId: user.id,
    action: input.confirmCommercials ? 'proposal.commercials_confirmed' : 'proposal.edited',
    entityType: 'proposal',
    entityId: id,
    previousValue: {
      subtotal: proposal.subtotal,
      total: proposal.total,
      taxRate: proposal.taxRate,
      discount: proposal.discount,
    },
    newValue: {
      taxRate: data.taxRate ?? proposal.taxRate,
      discount: data.discount ?? proposal.discount,
      items: input.items?.map((i) => ({ id: i.id, unitFee: i.unitFee, quantity: i.quantity })),
    },
  });

  const updated = await db.proposal.findUnique({ where: { id } });
  return ok({ id, total: updated?.total, commercialsSetBy: updated?.commercialsSetBy });
});
