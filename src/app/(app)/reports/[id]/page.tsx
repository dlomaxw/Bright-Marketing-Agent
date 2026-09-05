import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePagePermission } from '@/server/auth/guard';
import { can } from '@/server/auth/permissions';
import { parseJson } from '@/lib/json';
import { z } from 'zod';
import {
  Badge,
  Card,
  DefinitionRow,
  Notice,
  PageHeader,
  SeverityBadge,
  formatDate,
} from '@/components/ui';
import { ReportEditor } from '@/components/report-editor';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await db.report.findUnique({ where: { id }, select: { title: true, version: true } });
  return { title: r ? `${r.title} v${r.version}` : 'Report' };
}

const zAiRecord = z.object({
  provider: z.string(),
  issues: z.array(z.object({ code: z.string(), message: z.string() })),
});

export default async function ReportDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePagePermission('audit.read');

  const report = await db.report.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, legalName: true, brandName: true, website: true } },
      sections: { orderBy: { sortOrder: 'asc' } },
      findings: { include: { finding: true }, orderBy: { sortOrder: 'asc' } },
      approvals: {
        orderBy: { submittedAt: 'desc' },
        include: { submittedBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
      },
    },
  });

  if (!report || report.deletedAt) notFound();

  const included = report.findings.filter((f) => f.included);
  const excluded = report.findings.filter((f) => !f.included);
  const ai = parseJson(report.aiOutputJson, zAiRecord, { provider: 'deterministic', issues: [] });

  const locked = ['approved', 'superseded'].includes(report.status);

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link href="/reports" className="hover:underline">Reports</Link>
            {' · '}
            <Link href={`/leads/${report.organization.id}`} className="hover:underline">
              {report.organization.brandName ?? report.organization.legalName}
            </Link>
          </>
        }
        title={report.title}
        description={`Version ${report.version} · ${included.length} finding(s) included, ${excluded.length} excluded`}
        actions={
          <>
            <Badge
              tone={
                report.status === 'approved'
                  ? 'good'
                  : report.status === 'pending_approval'
                    ? 'blue'
                    : report.status === 'changes_requested'
                      ? 'warn'
                      : report.status === 'superseded'
                        ? 'muted'
                        : 'neutral'
              }
            >
              {report.status.replace(/_/g, ' ')}
            </Badge>
            <a href={`/api/reports/${report.id}/export?format=pdf`} className="rounded-md border border-line bg-white px-3 py-1.5 text-[13px] font-semibold text-navy hover:bg-canvas">
              Export PDF
            </a>
            <a href={`/api/reports/${report.id}/export?format=docx`} className="rounded-md border border-line bg-white px-3 py-1.5 text-[13px] font-semibold text-navy hover:bg-canvas">
              Export DOCX
            </a>
          </>
        }
      />

      {ai.issues.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn" title="The AI draft was rejected and a deterministic draft was used instead">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {ai.issues.map((issue, i) => (
                <li key={i}>{issue.message}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-[12px]">
              Nothing the model wrote reached this document. Review the sections below before
              submitting.
            </p>
          </Notice>
        </div>
      )}

      {report.status === 'superseded' && (
        <div className="mb-4">
          <Notice tone="info">
            A newer version of this report exists. This version is kept for the record.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0">
          <ReportEditor
            reportId={report.id}
            status={report.status}
            version={report.version}
            sections={report.sections.map((s) => ({
              id: s.id,
              key: s.key,
              heading: s.heading,
              body: s.body,
              included: s.included,
              editedByHuman: s.editedByHuman,
            }))}
            permissions={{
              edit: can(user.role, 'report.edit') && !locked,
              submit: can(user.role, 'report.submit'),
              approve: can(user.role, 'report.approve'),
            }}
          />
        </div>

        <aside className="space-y-4">
          <Card title="Report record">
            <dl>
              <DefinitionRow label="Organization">
                <Link href={`/leads/${report.organization.id}`} className="text-blue hover:underline">
                  {report.organization.brandName ?? report.organization.legalName}
                </Link>
              </DefinitionRow>
              <DefinitionRow label="Website">
                {report.organization.website ?? <span className="text-muted-soft">Not recorded</span>}
              </DefinitionRow>
              <DefinitionRow label="Created">{formatDate(report.createdAt, true)}</DefinitionRow>
              <DefinitionRow label="Drafted by">
                {ai.provider === 'anthropic' && report.generatedByAi ? (
                  <Badge tone="blue">AI-assisted, validated</Badge>
                ) : (
                  <Badge tone="muted">deterministic template</Badge>
                )}
              </DefinitionRow>
              <DefinitionRow label="Approved">
                {report.approvedAt ? formatDate(report.approvedAt, true) : <span className="text-muted-soft">Not approved</span>}
              </DefinitionRow>
            </dl>
          </Card>

          <Card
            title={`Findings included (${included.length})`}
            description="Every claim in this report traces to one of these."
            padded={false}
          >
            {included.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-soft">
                No findings are included. Verify findings and mark them client-facing, then generate
                a new version.
              </p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {included.map(({ finding }) => (
                  <li key={finding.id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/findings/${finding.id}`} className="font-mono text-[11px] font-semibold text-blue hover:underline">
                        {finding.reference}
                      </Link>
                      <SeverityBadge severity={finding.severity} />
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-ink">{finding.observation_text}</p>
                    <p className="text-[11px] text-muted-soft">
                      observed {formatDate(finding.observedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {excluded.length > 0 && (
            <Card
              title={`Findings excluded (${excluded.length})`}
              description="Shown so nothing is dropped silently."
              padded={false}
            >
              <ul className="divide-y divide-line-soft">
                {excluded.map((row) => (
                  <li key={row.finding.id} className="px-4 py-2.5">
                    <Link href={`/findings/${row.finding.id}`} className="font-mono text-[11px] font-semibold text-blue hover:underline">
                      {row.finding.reference}
                    </Link>
                    <p className="mt-0.5 line-clamp-1 text-[12px] text-ink">{row.finding.observation_text}</p>
                    <p className="text-[11px] text-high">{row.excludeReason}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Approval history" padded={false}>
            {report.approvals.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-soft">Not yet submitted.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {report.approvals.map((a) => (
                  <li key={a.id} className="px-4 py-2.5 text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone={a.status === 'approved' ? 'good' : a.status === 'rejected' ? 'critical' : 'blue'}>
                        v{a.entityVersion} {a.status}
                      </Badge>
                      <span className="text-[11px] text-muted-soft">{formatDate(a.decidedAt ?? a.submittedAt)}</span>
                    </div>
                    <p className="mt-0.5 text-muted">
                      {a.submittedBy?.name ?? 'unknown'}
                      {a.decidedBy ? ` → ${a.decidedBy.name}` : ' · awaiting decision'}
                    </p>
                    {a.comment && <p className="mt-0.5 italic text-ink">&ldquo;{a.comment}&rdquo;</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
