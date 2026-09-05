import { db } from '@/lib/db';
import { emailKey } from '@/lib/normalize';
import { SENSITIVE_SECTORS, type Sector } from '@/lib/enums';
import { getSetting } from '@/server/settings';
import { BANNED_PATTERNS } from '@/ai/contract';

/**
 * The send gates.
 *
 * Every gate is evaluated server-side immediately before sending, never trusted
 * from the client and never cached from approval time. The UI renders this same
 * structure as a checklist, so what the user sees is exactly what the server
 * enforces.
 */

export type GateStatus = 'pass' | 'fail' | 'warn';

export interface Gate {
  key: string;
  label: string;
  status: GateStatus;
  detail: string;
  /** How to fix it, shown as a link target in the UI. */
  fixHint?: string;
}

export interface GateReport {
  gates: Gate[];
  sendable: boolean;
  blockingCount: number;
  evaluatedAt: string;
}

const pass = (key: string, label: string, detail: string): Gate => ({
  key,
  label,
  status: 'pass',
  detail,
});
const fail = (key: string, label: string, detail: string, fixHint?: string): Gate => ({
  key,
  label,
  status: 'fail',
  detail,
  fixHint,
});
const warn = (key: string, label: string, detail: string): Gate => ({
  key,
  label,
  status: 'warn',
  detail,
});

export async function evaluateGates(emailDraftId: string): Promise<GateReport> {
  const gates: Gate[] = [];

  const draft = await db.emailDraft.findUnique({
    where: { id: emailDraftId },
    include: {
      organization: true,
      contact: true,
      report: true,
      proposal: true,
      findings: { include: { finding: true } },
      approvals: { orderBy: { submittedAt: 'desc' } },
    },
  });

  if (!draft) {
    return {
      gates: [fail('exists', 'Draft exists', 'The email draft was not found.')],
      sendable: false,
      blockingCount: 1,
      evaluatedAt: new Date().toISOString(),
    };
  }

  const outreach = await getSetting('outreach.rules');

  // 1 - Recipient identified and verified -----------------------------------
  if (!draft.contact) {
    gates.push(
      fail('recipient', 'Recipient selected', 'No contact has been selected for this email.', 'contacts'),
    );
  } else if (!draft.contact.email) {
    gates.push(
      fail(
        'recipient',
        'Recipient selected',
        `${draft.contact.name} has no email address on record.`,
        'contacts',
      ),
    );
  } else if (draft.contact.verificationStatus !== 'verified') {
    gates.push(
      fail(
        'recipient',
        'Recipient verified',
        `${draft.contact.name}'s contact details are marked "${draft.contact.verificationStatus}". Verify the address and its source before sending.`,
        'contacts',
      ),
    );
  } else {
    gates.push(
      pass('recipient', 'Recipient verified', `${draft.contact.name} <${draft.contact.email}> is verified.`),
    );
  }

  // 2 - The address on the draft still matches the contact -------------------
  const draftKey = emailKey(draft.toEmail);
  const contactKey = emailKey(draft.contact?.email);
  if (draftKey && contactKey && draftKey !== contactKey) {
    gates.push(
      fail(
        'recipient_match',
        'Address matches the contact record',
        `The draft is addressed to ${draft.toEmail} but the selected contact's address is ${draft.contact?.email}.`,
      ),
    );
  } else if (!draftKey) {
    gates.push(fail('recipient_match', 'Address present', 'The draft has no recipient address.'));
  } else {
    gates.push(pass('recipient_match', 'Address matches the contact record', draft.toEmail ?? ''));
  }

  // 3 - Opt-out and suppression --------------------------------------------
  if (draft.contact?.optedOut) {
    gates.push(
      fail(
        'optout',
        'Recipient has not opted out',
        `${draft.contact.name} opted out on ${draft.contact.optOutAt?.toISOString().slice(0, 10) ?? 'an earlier date'}. This contact must not be emailed.`,
      ),
    );
  } else {
    const suppressed = draftKey
      ? await db.suppressionEntry.findUnique({ where: { emailKey: draftKey } })
      : null;
    const domainSuppressed = draft.organization.domainKey
      ? await db.suppressionEntry.findFirst({
          where: { domainKey: draft.organization.domainKey },
        })
      : null;

    if (suppressed) {
      gates.push(
        fail(
          'optout',
          'Recipient is not suppressed',
          `This address is on the suppression list (${suppressed.reason}).`,
          'settings/suppression',
        ),
      );
    } else if (domainSuppressed) {
      gates.push(
        fail(
          'optout',
          'Organization is not suppressed',
          `The whole domain ${draft.organization.domainKey} is suppressed (${domainSuppressed.reason}).`,
          'settings/suppression',
        ),
      );
    } else {
      gates.push(pass('optout', 'Recipient is not suppressed', 'No opt-out or suppression on record.'));
    }
  }

  // 4 - Frequency cap -------------------------------------------------------
  const since = new Date(Date.now() - outreach.frequencyCapDays * 86_400_000);
  const recentSends = await db.emailDraft.count({
    where: {
      organizationId: draft.organizationId,
      id: { not: draft.id },
      sentAt: { gte: since },
      status: { in: ['sent', 'delivered', 'replied'] },
    },
  });
  if (recentSends >= outreach.frequencyCapCount) {
    gates.push(
      fail(
        'frequency',
        'Frequency cap',
        `${recentSends} message(s) already sent to this organization in the last ${outreach.frequencyCapDays} days (cap is ${outreach.frequencyCapCount}).`,
      ),
    );
  } else {
    gates.push(
      pass(
        'frequency',
        'Frequency cap',
        `${recentSends} of ${outreach.frequencyCapCount} messages used in the last ${outreach.frequencyCapDays} days.`,
      ),
    );
  }

  // 5 - Evidence freshness --------------------------------------------------
  const staleBefore = new Date(Date.now() - outreach.freshnessHours * 3600_000);
  const referenced = draft.findings.map((f) => f.finding);
  if (referenced.length === 0) {
    gates.push(
      warn(
        'evidence',
        'Evidence referenced',
        'This email references no specific finding. A personalised observation usually performs better than a generic message.',
      ),
    );
  } else {
    const stale = referenced.filter((f) => f.observedAt < staleBefore);
    const unverified = referenced.filter((f) => f.verificationStatus !== 'manually_verified');
    if (unverified.length > 0) {
      gates.push(
        fail(
          'evidence',
          'Referenced findings are verified',
          `${unverified.length} referenced finding(s) have not been manually verified: ${unverified.map((f) => f.reference).join(', ')}.`,
          'findings',
        ),
      );
    } else if (stale.length > 0) {
      gates.push(
        fail(
          'evidence',
          'Evidence is fresh',
          `${stale.length} referenced finding(s) were last observed more than ${outreach.freshnessHours} hours ago. Re-check before contacting: ${stale.map((f) => f.reference).join(', ')}.`,
          'findings',
        ),
      );
    } else {
      gates.push(
        pass(
          'evidence',
          'Evidence is fresh and verified',
          `${referenced.length} verified finding(s), all observed within ${outreach.freshnessHours} hours.`,
        ),
      );
    }
  }

  // 6 - Subject and body ----------------------------------------------------
  if (!draft.subject.trim()) {
    gates.push(fail('subject', 'Subject line', 'The subject line is empty.'));
  } else if (draft.subject.length > 120) {
    gates.push(warn('subject', 'Subject line', 'The subject line is unusually long.'));
  } else {
    gates.push(pass('subject', 'Subject line', draft.subject));
  }

  const content = `${draft.subject}\n${draft.body}`;
  const banned = BANNED_PATTERNS.filter((b) => b.pattern.test(content));
  if (draft.body.trim().length < 40) {
    gates.push(fail('body', 'Email body', 'The email body is empty or too short to send.'));
  } else if (banned.length > 0) {
    gates.push(
      fail(
        'body',
        'Language check',
        `The message contains language this product does not allow: ${banned.map((b) => b.why).join('; ')}.`,
      ),
    );
  } else if (/\[[A-Z_ ]+\]|\{\{|\bTODO\b/.test(content)) {
    gates.push(
      fail('body', 'Placeholders resolved', 'The message still contains unresolved placeholders.'),
    );
  } else {
    gates.push(pass('body', 'Language check', 'No prohibited or alarmist language detected.'));
  }

  // 7 - Sender --------------------------------------------------------------
  if (!draft.senderEmail || !draft.senderName) {
    gates.push(fail('sender', 'Approved sender', 'No sender identity is set on this draft.', 'settings'));
  } else {
    gates.push(pass('sender', 'Approved sender', `${draft.senderName} <${draft.senderEmail}>`));
  }

  // 8 - Attachments are approved versions -----------------------------------
  const attachmentIssues: string[] = [];
  if (draft.attachReport) {
    if (!draft.report) attachmentIssues.push('a report is marked for attachment but none is linked');
    else if (draft.report.status !== 'approved')
      attachmentIssues.push(`report v${draft.report.version} is "${draft.report.status}", not approved`);
  }
  if (draft.attachProposal) {
    if (!draft.proposal) attachmentIssues.push('a proposal is marked for attachment but none is linked');
    else if (draft.proposal.status !== 'approved')
      attachmentIssues.push(`proposal v${draft.proposal.version} is "${draft.proposal.status}", not approved`);
  }
  if (attachmentIssues.length > 0) {
    gates.push(fail('attachments', 'Attachments approved', attachmentIssues.join('; ')));
  } else if (draft.attachReport || draft.attachProposal) {
    const parts = [
      draft.attachReport && draft.report ? `report v${draft.report.version}` : null,
      draft.attachProposal && draft.proposal ? `proposal v${draft.proposal.version}` : null,
    ].filter(Boolean);
    gates.push(pass('attachments', 'Attachments approved', `Attaching approved ${parts.join(' and ')}.`));
  } else {
    gates.push(pass('attachments', 'Attachments', 'No attachments.'));
  }

  // 9 - Content approval ----------------------------------------------------
  const approval = draft.approvals.find((a) => a.status === 'approved' && a.entityVersion === draft.version);
  if (draft.status !== 'approved' || !approval) {
    gates.push(
      fail(
        'approval',
        'Approved for sending',
        draft.status === 'draft'
          ? 'This draft has not been submitted for approval.'
          : `The draft status is "${draft.status}". An approver must approve version ${draft.version}.`,
        'approvals',
      ),
    );
  } else {
    gates.push(
      pass(
        'approval',
        'Approved for sending',
        `Version ${draft.version} approved on ${approval.decidedAt?.toISOString().slice(0, 16).replace('T', ' ')}.`,
      ),
    );
  }

  // 10 - Sensitive sector senior approval -----------------------------------
  if (SENSITIVE_SECTORS.includes(draft.organization.sector as Sector)) {
    const approverId = approval?.decidedById;
    const approver = approverId ? await db.user.findUnique({ where: { id: approverId } }) : null;
    if (!approver?.seniorApprover) {
      gates.push(
        fail(
          'senior_approval',
          'Senior approval for a sensitive sector',
          `${draft.organization.legalName} is in the "${draft.organization.sector}" sector, which requires approval by a senior approver.`,
          'settings/users',
        ),
      );
    } else {
      gates.push(
        pass(
          'senior_approval',
          'Senior approval for a sensitive sector',
          `Approved by ${approver.name} (senior approver).`,
        ),
      );
    }
  }

  // 11 - Duplicate send prevention ------------------------------------------
  if (draft.sentAt) {
    gates.push(
      fail(
        'duplicate',
        'Not already sent',
        `This draft was already sent on ${draft.sentAt.toISOString().slice(0, 16).replace('T', ' ')}.`,
      ),
    );
  } else {
    gates.push(pass('duplicate', 'Not already sent', 'No previous send recorded for this draft.'));
  }

  const blocking = gates.filter((g) => g.status === 'fail');
  return {
    gates,
    sendable: blocking.length === 0,
    blockingCount: blocking.length,
    evaluatedAt: new Date().toISOString(),
  };
}
