import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError } from '@/lib/api';
import { logActivity } from '@/server/activity';
import { can } from '@/server/auth/permissions';
import { evaluateGates } from './gates';
import {
  buildProposalDocument,
  buildReportDocument,
  renderDocument,
} from '@/documents/deliverables';
import type { SessionUser } from '@/server/auth/session';

/**
 * Sending.
 *
 * The gates are re-evaluated here, at send time, against the database - not
 * against anything the browser submitted and not against the snapshot taken at
 * approval. If a contact opted out five seconds ago, this is where that is
 * caught.
 */

export interface SendResult {
  status: 'sent' | 'recorded_manually';
  providerId: string | null;
  channel: 'provider' | 'manual';
}

export async function sendApprovedEmail(
  emailDraftId: string,
  user: SessionUser,
  options: { manual?: boolean; manualNote?: string } = {},
): Promise<SendResult> {
  const report = await evaluateGates(emailDraftId);
  if (!report.sendable) {
    const blocking = report.gates.filter((g) => g.status === 'fail');
    throw new AppError(
      `This email cannot be sent. ${blocking.length} check${blocking.length === 1 ? '' : 's'} did not pass.`,
      409,
      { gates: blocking },
    );
  }

  const draft = await db.emailDraft.findUnique({
    where: { id: emailDraftId },
    include: { contact: true, organization: true, approvals: true },
  });
  if (!draft) throw new AppError('Email draft not found.', 404);

  // Separation of duties at send time as well as approval time.
  const approval = draft.approvals.find(
    (a) => a.status === 'approved' && a.entityVersion === draft.version,
  );
  /**
   * The same exemption as the approval step, rather than a different answer at
   * the last moment.
   *
   * An administrator who may approve their own submission may also send it —
   * blocking here would only produce an email approved and ready that nobody
   * present is allowed to send, which is a dead end rather than a control.
   * Every other role still needs a second person, and the global
   * ALLOW_SELF_SEND_AFTER_APPROVAL escape hatch is unchanged.
   *
   * The activity log already records a self-approval as one, so the trail
   * still shows that one person did all three steps.
   */
  if (
    !env.ALLOW_SELF_SEND_AFTER_APPROVAL &&
    !can(user.role, 'approval.self_approve') &&
    approval?.decidedById === user.id &&
    approval?.submittedById === user.id
  ) {
    throw new AppError('You both submitted and approved this email, so you cannot also send it.', 403);
  }

  // Idempotency: a deterministic key over the identity of this exact send.
  const sendKey = createHash('sha256')
    .update(`${draft.id}:${draft.version}:${draft.toEmail}:${draft.subject}`)
    .digest('hex');

  const existing = await db.emailDraft.findFirst({ where: { sendKey } });
  if (existing && existing.id !== draft.id) {
    throw new AppError('An identical message has already been sent.', 409);
  }
  if (draft.sendKey === sendKey && draft.sentAt) {
    throw new AppError('This message has already been sent.', 409);
  }

  const manual = options.manual || env.EMAIL_PROVIDER === 'console';
  /**
   * Render the approved report and proposal the draft says it is attaching.
   *
   * Built from the same builder the export routes use, so the attachment is
   * the document that was downloaded and approved rather than a second
   * rendering that could drift from it.
   *
   * A failure here stops the send. The gate has already told the approver
   * "Attaching approved report v2 and proposal v1", and a message going out
   * without them would quietly contradict what the approver agreed to — and
   * leave the recipient reading about an audit that was never enclosed.
   */
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];

  if (draft.attachReport && draft.reportId) {
    const doc = await buildReportDocument(draft.reportId, draft.senderName ?? undefined);
    if (!doc) throw new AppError('The report to attach could not be found.', 409);
    attachments.push({
      filename: `${doc.filename}.pdf`,
      content: await renderDocument(doc, 'pdf'),
      contentType: 'application/pdf',
    });
  }

  if (draft.attachProposal && draft.proposalId) {
    const doc = await buildProposalDocument(draft.proposalId, draft.senderName ?? undefined);
    if (!doc) throw new AppError('The proposal to attach could not be found.', 409);
    attachments.push({
      filename: `${doc.filename}.pdf`,
      content: await renderDocument(doc, 'pdf'),
      contentType: 'application/pdf',
    });
  }

  let providerId: string | null = null;

  if (!manual) {
    try {
      providerId = await deliver({
        to: draft.toEmail!,
        toName: draft.toName ?? '',
        from: draft.senderEmail!,
        fromName: draft.senderName!,
        replyTo: draft.replyTo,
        subject: draft.subject,
        body: draft.body,
        attachments,
      });
    } catch (err) {
      // Record why it failed and leave the draft unsent, so it is visibly
      // outstanding rather than silently lost. `sendKey` stays unset, so a
      // retry after the fix is allowed.
      const reason = err instanceof Error ? err.message : String(err);
      await db.emailDraft.update({
        where: { id: draft.id },
        data: { failureReason: reason.slice(0, 1000) },
      });
      await logActivity({
        organizationId: draft.organizationId,
        actorId: user.id,
        action: 'email.send_failed',
        entityType: 'email_draft',
        entityId: draft.id,
        reason,
      });
      throw err;
    }
  }

  await db.$transaction([
    db.emailDraft.update({
      where: { id: draft.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        sentById: user.id,
        sendKey,
        providerId,
        sendChannel: manual ? 'manual' : 'provider',
        gateResultJson: JSON.stringify(report),
        failureReason: null,
      },
    }),
    db.message.create({
      data: {
        emailDraftId: draft.id,
        contactId: draft.contactId,
        direction: 'outbound',
        channel: 'email',
        subject: draft.subject,
        body: draft.body,
        providerId,
        status: manual ? 'recorded_manually' : 'sent',
        loggedById: user.id,
      },
    }),
    db.organization.update({
      where: { id: draft.organizationId },
      data: {
        lastContactedAt: new Date(),
        stage: ['won', 'lost'].includes(draft.organization.stage)
          ? draft.organization.stage
          : 'contacted',
      },
    }),
  ]);

  await logActivity({
    organizationId: draft.organizationId,
    actorId: user.id,
    action: manual ? 'email.recorded_manually' : 'email.sent',
    entityType: 'email_draft',
    entityId: draft.id,
    newValue: {
      to: draft.toEmail,
      subject: draft.subject,
      version: draft.version,
      providerId,
      gates: report.gates.map((g) => `${g.key}:${g.status}`),
    },
    reason: options.manualNote ?? null,
  });

  return {
    status: manual ? 'recorded_manually' : 'sent',
    providerId,
    channel: manual ? 'manual' : 'provider',
  };
}

/**
 * Provider adapter. The `console` provider is the default and contacts nobody -
 * it writes the message to the activity log and the outbox so the workflow can
 * be exercised end to end without any risk of reaching a real prospect.
 */
async function deliver(message: {
  to: string;
  toName: string;
  from: string;
  fromName: string;
  replyTo: string | null;
  subject: string;
  body: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}): Promise<string> {
  switch (env.EMAIL_PROVIDER) {
    case 'smtp': {
      // Real delivery, via Spacemail. Reached only after the send gates have
      // passed and a second person has approved the message.
      const { deliverBySmtp } = await import('./smtp');
      try {
        return await deliverBySmtp(message);
      } catch (err) {
        // A delivery failure must never look like a delivered message: the
        // caller leaves the draft unsent and records the reason.
        throw new AppError(
          `The message was not delivered: ${err instanceof Error ? err.message : String(err)}`,
          502,
        );
      }
    }
    case 'console':
    default: {
      console.info(
        JSON.stringify({
          level: 'info',
          event: 'email.console_provider',
          note: 'No message was transmitted. EMAIL_PROVIDER=console.',
          to: message.to,
          subject: message.subject,
        }),
      );
      return `console-${Date.now()}`;
    }
  }
}
