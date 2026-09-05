import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { PIPELINE_STAGES, STAGE_LABELS, type PipelineStage } from '@/lib/enums';
import { Card, PageHeader, ScorePill } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pipeline' };

export default async function PipelinePage() {
  await requirePageUser();

  const orgs = await db.organization.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      legalName: true,
      brandName: true,
      website: true,
      stage: true,
      opportunityScore: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  const columns = PIPELINE_STAGES.map((stage) => {
    const items = orgs.filter((o) => o.stage === stage);
    return {
      stage: stage as PipelineStage,
      label: STAGE_LABELS[stage as PipelineStage] || stage,
      items,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pipeline"
        description="Visual overview of prospect movement through intake, technical audit, report publishing, commercial proposal, and outreach stages."
        actions={
          <Link
            href="/leads/new"
            className="inline-flex items-center gap-1 rounded bg-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy"
          >
            + Add Lead
          </Link>
        }
      />

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => (
          <div key={col.stage} className="w-72 shrink-0 rounded-lg border border-line bg-canvas p-3">
            <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
              <h3 className="text-xs font-semibold text-navy">{col.label}</h3>
              <span className="rounded bg-white px-2 py-0.5 text-[11px] font-bold text-muted shadow-xs">
                {col.items.length}
              </span>
            </div>

            <div className="space-y-2">
              {col.items.length === 0 ? (
                <div className="rounded border border-dashed border-line p-4 text-center text-[11px] text-muted">
                  No prospects in stage
                </div>
              ) : (
                col.items.map((org) => (
                  <Link key={org.id} href={`/leads/${org.id}`} className="block">
                    <Card padded className="hover:border-blue transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-navy text-xs line-clamp-1">
                          {org.legalName}
                        </span>
                        <ScorePill score={org.opportunityScore} />
                      </div>
                      {org.website && (
                        <p className="mt-1 truncate text-[11px] text-muted">{org.website}</p>
                      )}
                    </Card>
                  </Link>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
