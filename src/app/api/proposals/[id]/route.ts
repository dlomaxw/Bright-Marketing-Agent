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
  /** Lines to delete. A scope that no longer applies should leave the document. */
  removeItemIds: z.array(z.string()).max(100).default([]),
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

  /**
   * The pricing basis follows what was actually entered.
   *
   * Fees were being saved while the basis stayed at its "to_be_agreed"
   * default, and submitting then cleared every fee to match the basis — so
   * entering costs, saving and submitting silently wiped them and showed 0.
   * The data said one thing and the person meant the other.
   *
   * Entering a fee means a fixed price; clearing them all means the price is
   * discussed. Neither needs a separate switch to remember.
   */
  const linesAfterEdit = (() => {
    const removed = new Set(input.removeItemIds);
    const edits = new Map((input.items ?? []).map((i) => [i.id, i.unitFee]));
    return proposal.items
      .filter((i) => !removed.has(i.id))
      .map((i) => (edits.has(i.id) ? (edits.get(i.id) as number) : i.unitFee));
  })();

  if (linesAfterEdit.length > 0) {
    data.pricingBasis = linesAfterEdit.some((fee) => fee > 0) ? 'fixed' : 'to_be_agreed';
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
    ...(input.removeItemIds.length > 0
      ? [
          db.proposalItem.deleteMany({
            // Scoped to this proposal, so an id from elsewhere cannot delete
            // another proposal's line.
            where: { id: { in: input.removeItemIds }, proposalId: id },
          }),
        ]
      : []),
    ...(input.items ?? [])
      .filter((line) => !input.removeItemIds.includes(line.id))
      .map((line) =>
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

/**
 * Discards a proposal.
 *
 * A soft delete: `deletedAt` is set, every query already filters on it, and the
 * row stays for the audit trail. A proposal that was sent to a business is part
 * of the record of what that business was told, and removing it would leave the
 * outreach email pointing at nothing.
 *
 * An approved proposal is refused. Approval is a decision someone made on a
 * specific version; deleting it afterwards erases that decision rather than
 * reversing it. Supersede it with a new version instead.
 */
export const DELETE = apiHandler<Ctx>(async (_req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('proposal.edit');

  const proposal = await db.proposal.findUnique({
    where: { id },
    select: { id: true, status: true, version: true, organizationId: true, deletedAt: true },
  });
  if (!proposal || proposal.deletedAt) throw notFound('Proposal');

  if (proposal.status === 'approved') {
    throw badRequest(
      'An approved proposal cannot be deleted — approval is a decision on the record. Create a new version to supersede it.',
    );
  }

  const usedByEmail = await db.emailDraft.count({
    where: { proposalId: id, deletedAt: null, status: { in: ['sent', 'delivered', 'replied'] } },
  });
  if (usedByEmail > 0) {
    throw badRequest(
      'This proposal was sent to the client, so it is part of the record of what they were told. It cannot be deleted.',
    );
  }

  await db.proposal.update({ where: { id }, data: { deletedAt: new Date() } });

  await logActivity({
    organizationId: proposal.organizationId,
    actorId: user.id,
    action: 'proposal.deleted',
    entityType: 'proposal',
    entityId: id,
    previousValue: proposal.status,
    newValue: 'deleted',
    reason: `Version ${proposal.version} discarded.`,
  });

  return ok({ id, deleted: true });
});
