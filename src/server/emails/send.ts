import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError } from '@/lib/api';
import { logActivity } from '@/server/activity';
import { evaluateGates } from './gates';
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
  if (
    !env.ALLOW_SELF_SEND_AFTER_APPROVAL &&
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
