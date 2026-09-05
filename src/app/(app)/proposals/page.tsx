import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { Card, EmptyState, PageHeader, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Proposals' };

export default async function ProposalsPage() {
  await requirePageUser();

  const proposals = await db.proposal.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      organization: {
        select: {
          id: true,
          legalName: true,
          brandName: true,
          currency: true,
        },
      },
    },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proposals"
        description="Commercial proposals and service pricing recommendations derived from audit findings and human validation."
      />

      {proposals.length === 0 ? (
        <EmptyState
          title="No proposals created yet"
          description="Commercial proposals are constructed from verified findings in lead workspaces."
          action={
            <Link
              href="/leads"
              className="inline-flex items-center gap-1 rounded bg-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy"
            >
              Browse Leads
            </Link>
          }
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-canvas text-[11px] font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">Organization</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Commercial Terms</th>
                  <th className="px-4 py-2.5">Total Value</th>
                  <th className="px-4 py-2.5">Last Updated</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {proposals.map((proposal) => (
                  <tr key={proposal.id} className="hover:bg-canvas/50">
                    <td className="px-4 py-3 font-semibold text-navy">
                      <Link href={`/proposals/${proposal.id}`} className="hover:underline">
                        {proposal.organization.legalName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          proposal.status === 'approved'
                            ? 'bg-good-bg text-good'
                            : proposal.status === 'submitted'
                            ? 'bg-high-bg text-high'
                            : 'bg-canvas text-muted'
                        }`}
                      >
                        {proposal.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {proposal.commercialsSetBy ? (
                        <span className="text-good font-medium">Verified by Human</span>
                      ) : (
                        <span className="text-high font-medium">Pending Human Terms</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-navy">
                      {proposal.currency} {(proposal.total ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(proposal.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/proposals/${proposal.id}`}
                        className="font-semibold text-blue hover:underline"
                      >
                        Edit Proposal →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
