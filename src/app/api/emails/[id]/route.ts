import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiHandler, badRequest, body, notFound, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { changedFields, logActivity } from '@/server/activity';
import { emailKey } from '@/lib/normalize';

const schema = z.object({
  subject: z.string().max(200).optional(),
  body: z.string().max(20_000).optional(),
  contactId: z.string().nullable().optional(),
  attachReport: z.boolean().optional(),
  attachProposal: z.boolean().optional(),
  status: z.literal('cancelled').optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const input = await body(req, schema);

  const user = await requirePermission(input.status === 'cancelled' ? 'email.cancel' : 'email.edit');

  const draft = await db.emailDraft.findUnique({ where: { id } });
  if (!draft || draft.deletedAt) throw notFound('Email draft');

  if (draft.sentAt) {
    throw badRequest('This email has already been sent and can no longer be edited.');
  }

  if (input.status === 'cancelled') {
    await db.emailDraft.update({ where: { id }, data: { status: 'cancelled' } });
    await logActivity({
      organizationId: draft.organizationId,
      actorId: user.id,
      action: 'email.cancelled',
      entityType: 'email_draft',
      entityId: id,
      previousValue: draft.status,
      newValue: 'cancelled',
    });
    return ok({ id, status: 'cancelled' });
  }

  // An approved draft is frozen: editing it must produce a new version rather
  // than silently changing what an approver signed off.
  if (draft.status === 'approved') {
    throw badRequest(
      'This version is approved and cannot be edited. Cancel it and draft a new version if the message needs to change.',
    );
  }

  const data: Record<string, unknown> = {};
  if (input.subject !== undefined) data.subject = input.subject;
  if (input.body !== undefined) data.body = input.body;
  if (input.attachReport !== undefined) data.attachReport = input.attachReport;
  if (input.attachProposal !== undefined) data.attachProposal = input.attachProposal;

  if (input.contactId !== undefined) {
    if (input.contactId === null || input.contactId === '') {
      data.contactId = null;
      data.toEmail = null;
      data.toName = null;
    } else {
      const contact = await db.contact.findUnique({ where: { id: input.contactId } });
      if (!contact || contact.organizationId !== draft.organizationId) {
        throw badRequest('That contact does not belong to this organization.');
      }
      if (contact.optedOut) {
        throw badRequest(`${contact.name} has opted out of contact and cannot be selected.`);
      }
      if (!emailKey(contact.email)) {
        throw badRequest(`${contact.name} has no usable email address on record.`);
      }
      data.contactId = contact.id;
      data.toEmail = contact.email;
      data.toName = contact.name;
    }
  }

  // Editing after a rejection returns it to draft so it must be resubmitted.
  if (draft.status === 'changes_requested' || draft.status === 'needs_review') {
    data.status = 'draft';
  }

  const diff = changedFields(draft as unknown as Record<string, unknown>, data);
  if (!diff) return ok({ id, changed: false });

  await db.emailDraft.update({ where: { id }, data });

  await logActivity({
    organizationId: draft.organizationId,
    actorId: user.id,
    action: 'email.edited',
    entityType: 'email_draft',
    entityId: id,
    previousValue: diff.previous,
    newValue: diff.next,
  });

  return ok({ id, changed: true });
});

/**
 * Discards an email draft.
 *
 * A soft delete, and refused once the message has left the building. A sent
 * email is a thing a real business received: the outbox is the record of what
 * was said to them and when, and deleting the row would not unsend it — it
 * would only remove our ability to answer for it.
 *
 * Unsent drafts are fair game. Most of them are the agent's output that a
 * person decided against, and a review queue nobody can clear is a queue that
 * gets ignored.
 */
export const DELETE = apiHandler<Ctx>(async (_req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('email.cancel');

  const draft = await db.emailDraft.findUnique({
    where: { id },
    select: { id: true, status: true, organizationId: true, deletedAt: true, sentAt: true },
  });
  if (!draft || draft.deletedAt) throw notFound('Email draft');

  if (draft.sentAt || ['sent', 'delivered', 'replied', 'bounced'].includes(draft.status)) {
    throw badRequest(
      'This email was sent, so it is part of the record of what the client received. It cannot be deleted.',
    );
  }

  await db.emailDraft.update({ where: { id }, data: { deletedAt: new Date() } });

  await logActivity({
    organizationId: draft.organizationId,
    actorId: user.id,
    action: 'email.deleted',
    entityType: 'email',
    entityId: id,
    previousValue: draft.status,
    newValue: 'deleted',
    reason: 'Draft discarded before sending.',
  });

  return ok({ id, deleted: true });
});
