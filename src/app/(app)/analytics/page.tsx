import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { Card, PageHeader, StatTile } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analytics' };

export default async function AnalyticsPage() {
  await requirePageUser();

  const [
    totalOrgs,
    auditedOrgs,
    publishedReports,
    totalProposals,
    approvedEmails,
    findingCategoryStats,
  ] = await Promise.all([
    db.organization.count({ where: { deletedAt: null } }),
    db.organization.count({ where: { deletedAt: null, auditRuns: { some: {} } } }),
    db.report.count({ where: { status: 'approved', deletedAt: null } }),
    db.proposal.count({ where: { deletedAt: null } }),
    db.emailDraft.count({ where: { status: 'approved', deletedAt: null } }),
    db.finding.groupBy({
      by: ['category'],
      _count: { id: true },
      where: { deletedAt: null },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics & Intelligence"
        description="Audit efficiency, finding frequency distribution, and outreach conversion pipeline metrics."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
        <StatTile label="Total Prospects" value={totalOrgs} />
        <StatTile label="Audited Websites" value={auditedOrgs} tone="good" />
        <StatTile label="Published Reports" value={publishedReports} />
        <StatTile label="Commercial Proposals" value={totalProposals} />
        <StatTile label="Approved Outreach" value={approvedEmails} tone="good" />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card title="Finding Frequency by Category">
          <div className="space-y-3 text-xs">
            {findingCategoryStats.length === 0 ? (
              <p className="text-muted">No findings recorded yet.</p>
            ) : (
              findingCategoryStats.map((stat) => (
                <div key={stat.category} className="space-y-1">
                  <div className="flex justify-between font-semibold text-navy">
                    <span className="capitalize">{stat.category}</span>
                    <span>{stat._count.id} findings</span>
                  </div>
                  <div className="h-2 w-full rounded bg-canvas overflow-hidden">
                    <div
                      className="h-full bg-blue rounded"
                      style={{
                        width: `${Math.min(
                          100,
                          (stat._count.id / Math.max(1, totalOrgs * 3)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card title="Audit Compliance Metrics">
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="text-muted">Deterministic Audit Coverage</span>
              <span className="font-semibold text-navy">
                {totalOrgs > 0 ? Math.round((auditedOrgs / totalOrgs) * 100) : 0}%
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="text-muted">Report Conversion Rate</span>
              <span className="font-semibold text-navy">
                {auditedOrgs > 0 ? Math.round((publishedReports / auditedOrgs) * 100) : 0}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Outreach Safety Gate Compliance</span>
              <span className="font-semibold text-good">100% (Server-Enforced)</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
