import { db } from '@/lib/db';
import { AppError } from '@/lib/api';
import { logActivity } from '@/server/activity';
import { getSetting } from '@/server/settings';
import { BRAND } from '@/config/brand';
import type { SessionUser } from '@/server/auth/session';

/**
 * Email drafting.
 *
 * The message is assembled from verified facts only: the organization record,
 * at most two verified and fresh findings, and an approved sender signature.
 * No claim in the body originates anywhere else.
 */

const MAX_REFERENCED_FINDINGS = 2;

export async function createEmailDraft(args: {
  organizationId: string;
  contactId?: string | null;
  findingIds?: string[];
  reportId?: string | null;
  proposalId?: string | null;
  user: SessionUser;
}): Promise<{ id: string; warnings: string[] }> {
  const warnings: string[] = [];

  const org = await db.organization.findUnique({
    where: { id: args.organizationId },
    include: { contacts: { where: { deletedAt: null } } },
  });
  if (!org) throw new AppError('Organization not found.', 404);

  const outreach = await getSetting('outreach.rules');
  const brand = await getSetting('brand.details');
  const staleBefore = new Date(Date.now() - outreach.freshnessHours * 3600_000);

  // Recipient: prefer an explicitly chosen contact, else the best verified one.
  const contact = args.contactId
    ? org.contacts.find((c) => c.id === args.contactId)
    : org.contacts
        .filter((c) => !c.optedOut && !!c.email)
        .sort(
          (a, b) =>
            Number(b.verificationStatus === 'verified') - Number(a.verificationStatus === 'verified') ||
            Number(b.isPrimary) - Number(a.isPrimary),
        )[0];

  if (!contact) warnings.push('No suitable contact was found. Select a recipient before submitting.');
  if (contact?.optedOut) {
    throw new AppError(`${contact.name} has opted out of contact and cannot be emailed.`, 409);
  }

  // Findings: verified, client-visible and fresh, capped at two.
  const candidateWhere = {
    organizationId: org.id,
    deletedAt: null,
    verificationStatus: 'manually_verified',
    clientVisible: true,
    observedAt: { gte: staleBefore },
    ...(args.findingIds?.length ? { id: { in: args.findingIds } } : {}),
  };

  const findings = await db.finding.findMany({
    where: candidateWhere,
    orderBy: [{ severity: 'asc' }, { observedAt: 'desc' }],
    take: MAX_REFERENCED_FINDINGS,
  });

  if (args.findingIds?.length && findings.length < args.findingIds.length) {
    warnings.push(
      'Some requested findings were not usable (they must be verified, client-facing and observed recently). Only usable findings were referenced.',
    );
  }
  if (findings.length === 0) {
    warnings.push(
      'No verified, fresh finding is available to reference. A message with no specific observation is unlikely to be useful, and the send gate will flag it.',
    );
  }

  const orgName = org.brandName ?? org.legalName;
  const greetName = contact?.name && contact.name !== '(name not recorded)' ? contact.name.split(' ')[0] : null;

  const observationSentences = findings.map(
    (f) =>
      `we observed that ${lower(f.observation_text).replace(/\.$/, '')}${f.evidenceUrl ? ` (${f.evidenceUrl})` : ''}`,
  );

  const implication = findings[0]
    ? lower(findings[0].businessImpact).replace(/^this may /, '')
    : null;

  const subject = findings[0]
    ? `A quick observation about ${orgName}'s website`
    : `A short note about ${orgName}'s digital presence`;

  const body = [
    greetName ? `Hello ${greetName},` : `Hello,`,
    '',
    observationSentences.length > 0
      ? `While reviewing ${orgName}'s public digital presence, ${joinSentences(observationSentences)}.`
      : `We recently reviewed ${orgName}'s public digital presence.`,
    '',
    implication
      ? `This may ${implication.replace(/\.$/, '')}.`
      : 'We would be glad to share what we found.',
    '',
    `${brand.companyName} has prepared a short, evidence-based audit setting out what we observed, the quick corrections available, and a practical improvement plan.`,
    '',
    `Would you be available for a 20-minute discussion next week?`,
    '',
    'Kind regards,',
    args.user.signature?.trim() || [args.user.name, brand.companyName].filter(Boolean).join('\n'),
    '',
    /**
     * A footer that says who sent this, from where, and how to stop it.
     *
     * Not decoration. An unsolicited business message carrying none of that
     * reads as bulk mail to a filter and as a nuisance to a person. The
     * application already records `optedOut` on a contact and refuses to send
     * to them, so the way out has to actually exist — tracking opt-outs while
     * offering no way to opt out is the wrong half of the feature.
     */
    '--',
    [BRAND.legalEntity, BRAND.address].filter(Boolean).join(' · '),
    BRAND.phones.join(' · '),
    `You are receiving this because we audit publicly available business websites. Reply with "unsubscribe" and we will not contact ${orgName} again.`,
  ].join('\n');

  const latest = await db.emailDraft.findFirst({
    where: { organizationId: org.id },
    orderBy: { version: 'desc' },
  });

  const draft = await db.emailDraft.create({
    data: {
      organizationId: org.id,
      contactId: contact?.id ?? null,
      reportId: args.reportId ?? null,
      proposalId: args.proposalId ?? null,
      version: (latest?.version ?? 0) + 1,
      status: 'draft',
      subject,
      body,
      toEmail: contact?.email ?? null,
      toName: contact?.name ?? null,
      senderId: args.user.id,
      senderName: args.user.name,
      senderEmail: args.user.email,
      replyTo: args.user.email,
      attachReport: !!args.reportId,
      attachProposal: !!args.proposalId,
      authorId: args.user.id,
      generatedByAi: false,
      findings: { create: findings.map((f) => ({ findingId: f.id })) },
    },
  });

  await logActivity({
    organizationId: org.id,
    actorId: args.user.id,
    action: 'email.drafted',
    entityType: 'email_draft',
    entityId: draft.id,
    newValue: { findings: findings.map((f) => f.reference), contact: contact?.id ?? null },
  });

  return { id: draft.id, warnings };
}

const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function joinSentences(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
