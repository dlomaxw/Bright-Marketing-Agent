import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePagePermission } from '@/server/auth/guard';
import { can } from '@/server/auth/permissions';
import { evaluateGates } from '@/server/emails/gates';
import { EMAIL_STATUS_LABELS, type EmailStatus } from '@/lib/enums';
import { integrations, env } from '@/lib/env';
import {
  Badge,
  Card,
  DefinitionRow,
  Notice,
  PageHeader,
  formatDate,
  relativeAge,
} from '@/components/ui';
import { EmailWorkbench } from '@/components/email-workbench';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await db.emailDraft.findUnique({ where: { id }, select: { subject: true } });
  return { title: d ? d.subject : 'Email draft' };
}

export default async function EmailDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePagePermission('email.draft');

  const draft = await db.emailDraft.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, legalName: true, brandName: true, sector: true } },
      contact: true,
      report: { select: { id: true, version: true, status: true } },
      proposal: { select: { id: true, version: true, status: true } },
      author: { select: { name: true } },
      findings: { include: { finding: true } },
      approvals: {
        orderBy: { submittedAt: 'desc' },
        include: {
          submittedBy: { select: { name: true } },
          decidedBy: { select: { name: true } },
        },
      },
      messages: { orderBy: { occurredAt: 'desc' } },
    },
  });

  if (!draft || draft.deletedAt) notFound();

  // Evaluated server-side. The UI renders exactly what the server will enforce.
  const gates = await evaluateGates(draft.id);
  const status = draft.status as EmailStatus;
  const sent = ['sent', 'delivered', 'replied', 'bounced'].includes(status);

  const contacts = await db.contact.findMany({
    where: { organizationId: draft.organizationId, deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
  });

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link href="/emails" className="hover:underline">Emails</Link>
            {' · '}
            <Link href={`/leads/${draft.organization.id}`} className="hover:underline">
              {draft.organization.brandName ?? draft.organization.legalName}
            </Link>
          </>
        }
        title={draft.subject || 'Untitled draft'}
        description={`Version ${draft.version} · drafted by ${draft.author?.name ?? 'unknown'} ${relativeAge(draft.createdAt)}`}
        actions={<Badge tone={sent ? 'good' : status === 'approved' ? 'blue' : 'neutral'}>{EMAIL_STATUS_LABELS[status]}</Badge>}
      />

      {!integrations.emailProvider && !sent && (
        <div className="mb-4">
          <Notice tone="info" title="No email provider is connected">
            <code className="rounded bg-white/60 px-1">EMAIL_PROVIDER={env.EMAIL_PROVIDER}</code>. An
            approved email is recorded in the outbox and the activity log; no message is transmitted.
            Use <strong>Record as sent manually</strong> once you have sent it yourself, so the
            pipeline and frequency cap stay accurate.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-4">
          <EmailWorkbench
            draft={{
              id: draft.id,
              version: draft.version,
              status: draft.status,
              subject: draft.subject,
              body: draft.body,
              toEmail: draft.toEmail,
              toName: draft.toName,
              contactId: draft.contactId,
              senderName: draft.senderName,
              senderEmail: draft.senderEmail,
              attachReport: draft.attachReport,
              attachProposal: draft.attachProposal,
            }}
            contacts={contacts.map((c) => ({
              id: c.id,
              name: c.name,
              email: c.email,
              role: c.role,
              verificationStatus: c.verificationStatus,
              optedOut: c.optedOut,
            }))}
            gates={gates}
            permissions={{
              edit: can(user.role, 'email.edit') && !sent,
              submit: can(user.role, 'email.submit'),
              approve: can(user.role, 'email.approve'),
              send: can(user.role, 'email.send'),
              cancel: can(user.role, 'email.cancel'),
            }}
            providerConnected={integrations.emailProvider}
          />

          <Card
            title="Referenced findings"
            description="At most two verified observations. Everything the message claims must come from these."
            padded={false}
          >
            {draft.findings.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-soft">
                No finding is referenced. A message with no specific observation is generic — the
                evidence gate flags this.
              </p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {draft.findings.map(({ finding }) => (
                  <li key={finding.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/findings/${finding.id}`} className="font-mono text-[11px] font-semibold text-blue hover:underline">
                          {finding.reference}
                        </Link>
                        <p className="mt-0.5 text-[13px] text-ink">{finding.observation_text}</p>
                        {finding.evidenceUrl && (
                          <a href={finding.evidenceUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 block break-all text-[11px] text-blue hover:underline">
                            {finding.evidenceUrl}
                          </a>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge tone={finding.verificationStatus === 'manually_verified' ? 'good' : 'warn'}>
                          {finding.verificationStatus.replace(/_/g, ' ')}
                        </Badge>
                        <p className="mt-1 text-[11px] text-muted-soft">
                          observed {relativeAge(finding.observedAt)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card title="Recipient and attachments">
            <dl>
              <DefinitionRow label="Organization">
                <Link href={`/leads/${draft.organization.id}`} className="text-blue hover:underline">
                  {draft.organization.brandName ?? draft.organization.legalName}
                </Link>
                {draft.organization.sector !== 'standard' && (
                  <Badge tone="warn">{draft.organization.sector} — senior approval</Badge>
                )}
              </DefinitionRow>
              <DefinitionRow label="Recipient">
                {draft.contact ? (
                  <>
                    {draft.contact.name}
                    <br />
                    <span className="text-muted">{draft.toEmail}</span>
                  </>
                ) : (
                  <span className="text-muted-soft">Not selected</span>
                )}
              </DefinitionRow>
              <DefinitionRow label="Contact verification">
                {draft.contact ? (
                  draft.contact.optedOut ? (
                    <Badge tone="critical">opted out</Badge>
                  ) : (
                    <Badge tone={draft.contact.verificationStatus === 'verified' ? 'good' : 'warn'}>
                      {draft.contact.verificationStatus}
                    </Badge>
                  )
                ) : (
                  '—'
                )}
              </DefinitionRow>
              <DefinitionRow label="Sender">
                {draft.senderName}
                <br />
                <span className="text-muted">{draft.senderEmail}</span>
              </DefinitionRow>
              <DefinitionRow label="Report attachment">
                {draft.attachReport && draft.report ? (
                  <Link href={`/reports/${draft.report.id}`} className="text-blue hover:underline">
                    v{draft.report.version} ({draft.report.status})
                  </Link>
                ) : (
                  <span className="text-muted-soft">None</span>
                )}
              </DefinitionRow>
              <DefinitionRow label="Proposal attachment">
                {draft.attachProposal && draft.proposal ? (
                  <Link href={`/proposals/${draft.proposal.id}`} className="text-blue hover:underline">
                    v{draft.proposal.version} ({draft.proposal.status})
                  </Link>
                ) : (
                  <span className="text-muted-soft">None</span>
                )}
              </DefinitionRow>
              {draft.sentAt && (
                <>
                  <DefinitionRow label="Sent at">{formatDate(draft.sentAt, true)}</DefinitionRow>
                  <DefinitionRow label="Channel">
                    <Badge tone={draft.sendChannel === 'manual' ? 'warn' : 'good'}>
                      {draft.sendChannel === 'manual' ? 'recorded manually' : 'sent via provider'}
                    </Badge>
                  </DefinitionRow>
                </>
              )}
            </dl>
          </Card>

          <Card title="Approval history" padded={false}>
            {draft.approvals.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-soft">Not yet submitted for approval.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {draft.approvals.map((a) => (
                  <li key={a.id} className="px-4 py-2.5 text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={a.status === 'approved' ? 'good' : a.status === 'rejected' ? 'critical' : 'blue'}>
                        v{a.entityVersion} {a.status}
                      </Badge>
                      <span className="text-[11px] text-muted-soft">
                        {formatDate(a.decidedAt ?? a.submittedAt, true)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-muted">
                      Submitted by {a.submittedBy?.name ?? 'unknown'}
                      {a.decidedBy ? ` · decided by ${a.decidedBy.name}` : ' · awaiting decision'}
                    </p>
                    {a.comment && <p className="mt-0.5 italic text-ink">&ldquo;{a.comment}&rdquo;</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {draft.messages.length > 0 && (
            <Card title="Communication record" padded={false}>
              <ul className="divide-y divide-line-soft">
                {draft.messages.map((m) => (
                  <li key={m.id} className="px-4 py-2.5 text-[12px]">
                    <div className="flex justify-between gap-2">
                      <Badge tone={m.direction === 'outbound' ? 'blue' : 'good'}>{m.direction}</Badge>
                      <span className="text-[11px] text-muted-soft">{formatDate(m.occurredAt, true)}</span>
                    </div>
                    <p className="mt-0.5 text-ink">{m.subject}</p>
                    {m.providerId && <p className="text-[11px] text-muted-soft">id: {m.providerId}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
