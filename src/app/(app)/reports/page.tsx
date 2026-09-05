import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { Card, EmptyState, PageHeader, ScorePill, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit Reports' };

export default async function ReportsPage() {
  await requirePageUser();

  const reports = await db.report.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      organization: {
        select: {
          id: true,
          legalName: true,
          brandName: true,
          website: true,
          opportunityScore: true,
        },
      },
    },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Reports"
        description="Comprehensive diagnostic reports generated from deterministic website evidence and verified findings."
      />

      {reports.length === 0 ? (
        <EmptyState
          title="No audit reports generated yet"
          description="Reports are created from lead workspaces after completing an audit and verifying findings."
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
                  <th className="px-4 py-2.5">Version</th>
                  <th className="px-4 py-2.5">Score</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Generated At</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {reports.map((report) => (
                  <tr key={report.id} className="hover:bg-canvas/50">
                    <td className="px-4 py-3 font-semibold text-navy">
                      <Link href={`/reports/${report.id}`} className="hover:underline">
                        {report.organization.legalName}
                      </Link>
                      {report.organization.website && (
                        <span className="block text-[11px] font-normal text-muted">
                          {report.organization.website}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">v{report.version}</td>
                    <td className="px-4 py-3">
                      <ScorePill score={report.organization.opportunityScore} />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          report.status === 'approved'
                            ? 'bg-good-bg text-good'
                            : 'bg-high-bg text-high'
                        }`}
                      >
                        {report.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(report.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/reports/${report.id}`}
                        className="font-semibold text-blue hover:underline"
                      >
                        View Report →
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
