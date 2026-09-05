import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { pendingApprovalCounts } from '@/server/approvals';
import { Card, EmptyState, PageHeader, StatTile, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Approvals Queue' };

export default async function ApprovalsPage() {
  await requirePageUser();
  const counts = await pendingApprovalCounts();

  const [pendingReports, pendingProposals, pendingEmails] = await Promise.all([
    db.report.findMany({
      where: { status: 'pending_approval', deletedAt: null },
      include: { organization: true },
      orderBy: { updatedAt: 'desc' },
    }),
    db.proposal.findMany({
      where: { status: 'pending_approval', deletedAt: null },
      include: { organization: true },
      orderBy: { updatedAt: 'desc' },
    }),
    db.emailDraft.findMany({
      where: { status: 'needs_review', deletedAt: null },
      include: { organization: true, author: true },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals Queue"
        description="Review pending reports, commercial proposals, and guarded outreach emails requiring separation-of-duties authorization."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatTile label="Total Pending" value={counts.total} tone={counts.total > 0 ? 'attention' : 'neutral'} />
        <StatTile label="Pending Reports" value={counts.reports} />
        <StatTile label="Pending Proposals" value={counts.proposals} />
        <StatTile label="Pending Emails" value={counts.emails} />
      </div>

      {counts.total === 0 ? (
        <EmptyState
          title="No pending approvals"
          description="All reports, commercial proposals, and outreach email drafts have been reviewed or are in draft status."
        />
      ) : (
        <div className="space-y-6">
          {pendingReports.length > 0 && (
            <Card title={`Pending Audit Reports (${pendingReports.length})`}>
              <div className="divide-y divide-line-soft">
                {pendingReports.map((report) => (
                  <div key={report.id} className="flex items-center justify-between py-3">
                    <div>
                      <Link href={`/reports/${report.id}`} className="font-semibold text-navy hover:underline">
                        {report.organization.legalName} — Audit Report v{report.version}
                      </Link>
                      <p className="text-xs text-muted">
                        Submitted for approval on {formatDate(report.updatedAt)}
                      </p>
                    </div>
                    <Link
                      href={`/reports/${report.id}`}
                      className="rounded bg-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy"
                    >
                      Review & Approve →
                    </Link>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {pendingProposals.length > 0 && (
            <Card title={`Pending Commercial Proposals (${pendingProposals.length})`}>
              <div className="divide-y divide-line-soft">
                {pendingProposals.map((proposal) => (
                  <div key={proposal.id} className="flex items-center justify-between py-3">
                    <div>
                      <Link href={`/proposals/${proposal.id}`} className="font-semibold text-navy hover:underline">
                        {proposal.organization.legalName} — Proposal v{proposal.version}
                      </Link>
                      <p className="text-xs text-muted">
                        Value: {proposal.currency} {(proposal.total ?? 0).toLocaleString()} • Submitted on{' '}
                        {formatDate(proposal.updatedAt)}
                      </p>
                    </div>
                    <Link
                      href={`/proposals/${proposal.id}`}
                      className="rounded bg-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy"
                    >
                      Review Terms →
                    </Link>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {pendingEmails.length > 0 && (
            <Card title={`Pending Outreach Emails (${pendingEmails.length})`}>
              <div className="divide-y divide-line-soft">
                {pendingEmails.map((email) => (
                  <div key={email.id} className="flex items-center justify-between py-3">
                    <div>
                      <Link href={`/emails/${email.id}`} className="font-semibold text-navy hover:underline">
                        {email.organization.legalName} — {email.subject || 'Draft Email'}
                      </Link>
                      <p className="text-xs text-muted">
                        To: {email.toEmail || '(No address)'} • Drafted by {email.author?.name || 'System'} on{' '}
                        {formatDate(email.updatedAt)}
                      </p>
                    </div>
                    <Link
                      href={`/emails/${email.id}`}
                      className="rounded bg-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy"
                    >
                      Check Gates →
                    </Link>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
