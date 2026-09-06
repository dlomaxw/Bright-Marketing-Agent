import { db } from '@/lib/db';
import { AppError } from '@/lib/api';
import { assertNotSelfApproval } from '@/server/auth/guard';
import { logActivity } from '@/server/activity';
import type { SessionUser } from '@/server/auth/session';

/**
 * One approval workflow, shared by reports, proposals and emails.
 *
 * Invariants:
 *  - approving is only ever possible for the exact version that was submitted;
 *  - the submitter can never be the approver;
 *  - an approved artefact becomes immutable - editing it creates version n+1;
 *  - rejection requires a comment.
 */

export type ApprovableType = 'report' | 'proposal' | 'email';

interface Entity {
  id: string;
  version: number;
  status: string;
  organizationId: string;
}

async function loadEntity(type: ApprovableType, id: string): Promise<Entity> {
  const row =
    type === 'report'
      ? await db.report.findUnique({ where: { id } })
      : type === 'proposal'
        ? await db.proposal.findUnique({ where: { id } })
        : await db.emailDraft.findUnique({ where: { id } });
  if (!row) throw new AppError(`${type} not found.`, 404);
  return { id: row.id, version: row.version, status: row.status, organizationId: row.organizationId };
}

async function setStatus(type: ApprovableType, id: string, data: Record<string, unknown>): Promise<void> {
  if (type === 'report') await db.report.update({ where: { id }, data });
  else if (type === 'proposal') await db.proposal.update({ where: { id }, data });
  else await db.emailDraft.update({ where: { id }, data });
}

const pendingStatus = (type: ApprovableType) => (type === 'email' ? 'needs_review' : 'pending_approval');

export async function submitForApproval(
  type: ApprovableType,
  id: string,
  user: SessionUser,
  note?: string,
): Promise<void> {
  const entity = await loadEntity(type, id);

  if (entity.status === 'approved') {
    throw new AppError(
      `This ${type} is already approved. Edit it to create a new version, then submit that version.`,
      409,
    );
  }
  if (entity.status === pendingStatus(type)) {
    throw new AppError(`This ${type} is already awaiting approval.`, 409);
  }
  if (entity.status === 'sent') {
    throw new AppError('This email has already been sent.', 409);
  }

  /**
   * Proposals and money.
   *
   * A proposal may go out with no figures at all. The fee here depends on the
   * scope the client settles on, so it is agreed in conversation rather than
   * printed — and a document showing "UGX 0" against every line is worse than
   * one that says plainly the price is discussed once scope is agreed.
   *
   * A fee left on a price-on-discussion proposal is not refused. I blocked it
   * at first, reasoning that a half-priced document reads as a quotation — but
   * the export omits every money column under this basis, so such a document
   * cannot be produced. The guard only stopped people submitting proposals
   * whose stored fees the client would never see.
   *
   * The fees are cleared instead, so the record matches the document. Leaving
   * them would mean that switching the proposal to fixed pricing later
   * resurrected figures nobody had reviewed for this client.
   */
  if (type === 'proposal') {
    const proposal = await db.proposal.findUnique({ where: { id }, include: { items: true } });

    if (proposal && proposal.pricingBasis === 'fixed') {
      if (!proposal.commercialsSetBy) {
        throw new AppError(
          'This proposal is set to fixed pricing but the commercial terms have not been confirmed. An authorised user must set the fees, tax and payment terms, or change it to price-on-discussion.',
          409,
        );
      }
      if (proposal.items.some((i) => i.unitFee <= 0)) {
        throw new AppError(
          'One or more lines still have no fee. Set every fee, or change the proposal to price-on-discussion.',
          409,
        );
      }
    } else if (proposal && proposal.items.some((i) => i.unitFee > 0)) {
      const cleared = proposal.items.filter((i) => i.unitFee > 0).length;

      for (const item of proposal.items) {
        if (item.unitFee === 0 && item.lineTotal === 0) continue;
        await db.proposalItem.update({
          where: { id: item.id },
          data: { unitFee: 0, lineTotal: 0 },
        });
      }
      await db.proposal.update({
        where: { id: proposal.id },
        data: { subtotal: 0, taxAmount: 0, total: 0 },
      });

      await logActivity({
        organizationId: proposal.organizationId,
        actorId: user.id,
        action: 'proposal.fees_cleared',
        entityType: 'proposal',
        entityId: proposal.id,
        newValue: { linesCleared: cleared, pricingBasis: proposal.pricingBasis },
        reason:
          'Submitted as price-on-discussion, so stored fees were cleared to match the document, which carries no figures.',
      });
    }
  }

  await db.approval.create({
    data: {
      entityType: type,
      reportId: type === 'report' ? id : null,
      proposalId: type === 'proposal' ? id : null,
      emailDraftId: type === 'email' ? id : null,
      entityVersion: entity.version,
      kind: 'content',
      status: 'pending',
      submittedById: user.id,
      comment: note ?? null,
    },
  });

  await setStatus(type, id, { status: pendingStatus(type) });

  await db.organization.update({
    where: { id: entity.organizationId },
    data: { stage: 'awaiting_approval' },
  }).catch(() => undefined);

  await logActivity({
    organizationId: entity.organizationId,
    actorId: user.id,
    action: `${type}.submitted`,
    entityType: type,
    entityId: id,
    previousValue: entity.status,
    newValue: pendingStatus(type),
    reason: note ?? null,
  });
}

export async function decideApproval(
  type: ApprovableType,
  id: string,
  user: SessionUser,
  decision: 'approved' | 'rejected',
  comment?: string,
): Promise<void> {
  const entity = await loadEntity(type, id);

  const approval = await db.approval.findFirst({
    where: {
      entityType: type,
      status: 'pending',
      entityVersion: entity.version,
      ...(type === 'report' ? { reportId: id } : type === 'proposal' ? { proposalId: id } : { emailDraftId: id }),
    },
    orderBy: { submittedAt: 'desc' },
  });

  if (!approval) {
    throw new AppError(
      `There is no pending approval for version ${entity.version} of this ${type}.`,
      409,
    );
  }

  assertNotSelfApproval(user.id, approval.submittedById);

  if (decision === 'rejected' && !comment?.trim()) {
    throw new AppError('A comment is required when rejecting, so the author knows what to change.', 400);
  }

  await db.approval.update({
    where: { id: approval.id },
    data: {
      status: decision,
      decidedById: user.id,
      decidedAt: new Date(),
      comment: comment ?? null,
    },
  });

  const nextStatus = decision === 'approved' ? 'approved' : 'changes_requested';
  await setStatus(type, id, {
    status: nextStatus,
    ...(decision === 'approved'
      ? type === 'email'
        ? { approvedById: user.id, approvedAt: new Date() }
        : { approvedById: user.id, approvedAt: new Date() }
      : {}),
  });

  await logActivity({
    organizationId: entity.organizationId,
    actorId: user.id,
    action: `${type}.${decision}`,
    entityType: type,
    entityId: id,
    previousValue: entity.status,
    newValue: nextStatus,
    reason: comment ?? null,
  });
}

/**
 * Editing an approved artefact must never silently change what was approved.
 * This clones it as a new version in `draft`.
 */
export async function reviseApproved(
  type: ApprovableType,
  id: string,
  user: SessionUser,
): Promise<string> {
  if (type === 'report') {
    const source = await db.report.findUnique({
      where: { id },
      include: { sections: true, findings: true },
    });
    if (!source) throw new AppError('Report not found.', 404);
    await db.report.update({ where: { id }, data: { status: 'superseded' } });
    const copy = await db.report.create({
      data: {
        organizationId: source.organizationId,
        version: source.version + 1,
        title: source.title,
        status: 'draft',
        auditRunIdsJson: source.auditRunIdsJson,
        preparedBy: user.id,
        generatedByAi: source.generatedByAi,
        aiOutputJson: source.aiOutputJson,
        sections: {
          create: source.sections.map((s) => ({
            key: s.key,
            heading: s.heading,
            body: s.body,
            sortOrder: s.sortOrder,
            included: s.included,
            editedByHuman: s.editedByHuman,
          })),
        },
        findings: {
          create: source.findings.map((f) => ({
            findingId: f.findingId,
            included: f.included,
            excludeReason: f.excludeReason,
            sortOrder: f.sortOrder,
          })),
        },
      },
    });
    await logActivity({
      organizationId: source.organizationId,
      actorId: user.id,
      action: 'report.revised',
      entityType: 'report',
      entityId: copy.id,
      previousValue: `v${source.version}`,
      newValue: `v${copy.version}`,
    });
    return copy.id;
  }

  if (type === 'proposal') {
    const source = await db.proposal.findUnique({ where: { id }, include: { items: true } });
    if (!source) throw new AppError('Proposal not found.', 404);
    await db.proposal.update({ where: { id }, data: { status: 'superseded' } });
    const { id: _id, createdAt, updatedAt, version, status, approvedById, approvedAt, presentedAt, items, ...rest } = source;
    const copy = await db.proposal.create({
      data: {
        ...rest,
        version: version + 1,
        status: 'draft',
        approvedById: null,
        approvedAt: null,
        presentedAt: null,
        items: {
          create: items.map((i) => ({
            serviceModuleId: i.serviceModuleId,
            name: i.name,
            description: i.description,
            deliverablesJson: i.deliverablesJson,
            phase: i.phase,
            quantity: i.quantity,
            unit: i.unit,
            unitFee: i.unitFee,
            lineTotal: i.lineTotal,
            sourceFindingIdsJson: i.sourceFindingIdsJson,
            sortOrder: i.sortOrder,
          })),
        },
      },
    });
    await logActivity({
      organizationId: source.organizationId,
      actorId: user.id,
      action: 'proposal.revised',
      entityType: 'proposal',
      entityId: copy.id,
      previousValue: `v${source.version}`,
      newValue: `v${copy.version}`,
    });
    return copy.id;
  }

  const source = await db.emailDraft.findUnique({ where: { id }, include: { findings: true } });
  if (!source) throw new AppError('Email draft not found.', 404);
  const copy = await db.emailDraft.create({
    data: {
      organizationId: source.organizationId,
      contactId: source.contactId,
      reportId: source.reportId,
      proposalId: source.proposalId,
      version: source.version + 1,
      status: 'draft',
      subject: source.subject,
      body: source.body,
      toEmail: source.toEmail,
      toName: source.toName,
      senderId: source.senderId,
      senderName: source.senderName,
      senderEmail: source.senderEmail,
      replyTo: source.replyTo,
      attachReport: source.attachReport,
      attachProposal: source.attachProposal,
      authorId: user.id,
      findings: { create: source.findings.map((f) => ({ findingId: f.findingId })) },
    },
  });
  await db.emailDraft.update({ where: { id }, data: { status: 'cancelled' } });
  return copy.id;
}

export async function pendingApprovalCounts(): Promise<{
  reports: number;
  proposals: number;
  emails: number;
  total: number;
}> {
  const [reports, proposals, emails] = await Promise.all([
    db.report.count({ where: { status: 'pending_approval', deletedAt: null } }),
    db.proposal.count({ where: { status: 'pending_approval', deletedAt: null } }),
    db.emailDraft.count({ where: { status: 'needs_review', deletedAt: null } }),
  ]);
  return { reports, proposals, emails, total: reports + proposals + emails };
}
