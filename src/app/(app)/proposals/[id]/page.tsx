import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePagePermission } from '@/server/auth/guard';
import { can } from '@/server/auth/permissions';
import { parseStringArray } from '@/lib/json';
import { PHASE_LABELS } from '@/lib/enums';
import {
  Badge,
  Card,
  DefinitionRow,
  Notice,
  PageHeader,
  formatDate,
  money,
} from '@/components/ui';
import { ProposalEditor } from '@/components/proposal-editor';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await db.proposal.findUnique({ where: { id }, select: { title: true, version: true } });
  return { title: p ? `${p.title} v${p.version}` : 'Proposal' };
}

export default async function ProposalDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePagePermission('audit.read');

  const proposal = await db.proposal.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, legalName: true, brandName: true } },
      report: { select: { id: true, version: true, status: true } },
      items: { orderBy: { sortOrder: 'asc' }, include: { serviceModule: { select: { name: true, code: true } } } },
      approvals: {
        orderBy: { submittedAt: 'desc' },
        include: { submittedBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
      },
    },
  });

  if (!proposal || proposal.deletedAt) notFound();

  // Resolve the findings that justify each line, so the UI can show why a
  // service was recommended.
  const allFindingIds = [
    ...new Set(proposal.items.flatMap((i) => parseStringArray(i.sourceFindingIdsJson))),
  ];
  const findings = allFindingIds.length
    ? await db.finding.findMany({
        where: { id: { in: allFindingIds } },
        select: { id: true, reference: true, observation_text: true },
      })
    : [];
  const findingById = new Map(findings.map((f) => [f.id, f]));

  const locked = ['approved', 'superseded'].includes(proposal.status);
  const unpriced = proposal.items.filter((i) => i.unitFee <= 0);

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link href="/proposals" className="hover:underline">Proposals</Link>
            {' · '}
            <Link href={`/leads/${proposal.organization.id}`} className="hover:underline">
              {proposal.organization.brandName ?? proposal.organization.legalName}
            </Link>
          </>
        }
        title={proposal.title}
        description={`Version ${proposal.version} · ${proposal.items.length} service module(s)`}
        actions={
          <>
            <Badge
              tone={
                proposal.status === 'approved'
                  ? 'good'
                  : proposal.status === 'pending_approval'
                    ? 'blue'
                    : proposal.status === 'changes_requested'
                      ? 'warn'
                      : proposal.status === 'superseded'
                        ? 'muted'
                        : 'neutral'
              }
            >
              {proposal.status.replace(/_/g, ' ')}
            </Badge>
            <Link
              href={`/proposals/${proposal.id}/canvas`}
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-[13px] font-semibold text-amber-900 hover:bg-amber-100"
            >
              🎨 Canvas View
            </Link>
            <a href={`/api/proposals/${proposal.id}/export?format=pdf`} className="rounded-md border border-line bg-white px-3 py-1.5 text-[13px] font-semibold text-navy hover:bg-canvas">
              Export PDF
            </a>
            <a href={`/api/proposals/${proposal.id}/export?format=docx`} className="rounded-md border border-line bg-white px-3 py-1.5 text-[13px] font-semibold text-navy hover:bg-canvas">
              Export DOCX
            </a>
          </>
        }
      />

      {!proposal.commercialsSetBy && (
        <div className="mb-4">
          <Notice tone="warn" title="Commercial terms have not been confirmed">
            Prices, tax, payment terms and legal wording are set by an authorised person, never
            generated. This proposal cannot be submitted for approval until they are confirmed
            {unpriced.length > 0 && ` — ${unpriced.length} line(s) still have no fee`}.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0">
          <ProposalEditor
            proposal={{
              id: proposal.id,
              version: proposal.version,
              status: proposal.status,
              currency: proposal.currency,
              situation: proposal.situation ?? '',
              objectives: proposal.objectives ?? '',
              solution: proposal.solution ?? '',
              scope: proposal.scope ?? '',
              deliverables: proposal.deliverables ?? '',
              phases: proposal.phases ?? '',
              timeline: proposal.timeline ?? '',
              clientResponsibilities: proposal.clientResponsibilities ?? '',
              requiredAssets: proposal.requiredAssets ?? '',
              discount: proposal.discount,
              taxRate: proposal.taxRate,
              paymentSchedule: proposal.paymentSchedule ?? '',
              assumptions: proposal.assumptions ?? '',
              exclusions: proposal.exclusions ?? '',
              changeControl: proposal.changeControl ?? '',
              validUntil: proposal.validUntil ? proposal.validUntil.toISOString().slice(0, 10) : '',
              acceptanceTerms: proposal.acceptanceTerms ?? '',
              nextSteps: proposal.nextSteps ?? '',
              commercialsSetBy: proposal.commercialsSetBy,
              subtotal: proposal.subtotal,
              taxAmount: proposal.taxAmount,
              total: proposal.total,
            }}
            items={proposal.items.map((i) => ({
              id: i.id,
              name: i.name,
              description: i.description,
              phase: i.phase,
              quantity: i.quantity,
              unit: i.unit,
              unitFee: i.unitFee,
              lineTotal: i.lineTotal,
              justifications: parseStringArray(i.sourceFindingIdsJson)
                .map((fid) => findingById.get(fid))
                .filter((f): f is { id: string; reference: string; observation_text: string } => !!f),
            }))}
            permissions={{
              edit: can(user.role, 'proposal.edit') && !locked,
              commercials: can(user.role, 'proposal.set_commercials') && !locked,
              submit: can(user.role, 'proposal.submit'),
              approve: can(user.role, 'proposal.approve'),
            }}
          />
        </div>

        <aside className="space-y-4">
          <Card title="Investment summary">
            <dl>
              <DefinitionRow label="Currency">{proposal.currency}</DefinitionRow>
              <DefinitionRow label="Subtotal">{money(proposal.subtotal, proposal.currency)}</DefinitionRow>
              {proposal.discount > 0 && (
                <DefinitionRow label="Discount">-{money(proposal.discount, proposal.currency)}</DefinitionRow>
              )}
              <DefinitionRow label={`Tax (${Math.round(proposal.taxRate * 100)}%)`}>
                {money(proposal.taxAmount, proposal.currency)}
              </DefinitionRow>
              <DefinitionRow label="Total">
                <strong className="text-navy">{money(proposal.total, proposal.currency)}</strong>
              </DefinitionRow>
              <DefinitionRow label="Commercials confirmed">
                {proposal.commercialsSetBy ? (
                  <Badge tone="good">{formatDate(proposal.commercialsSetAt)}</Badge>
                ) : (
                  <Badge tone="warn">not confirmed</Badge>
                )}
              </DefinitionRow>
              <DefinitionRow label="Source report">
                {proposal.report ? (
                  <Link href={`/reports/${proposal.report.id}`} className="text-blue hover:underline">
                    v{proposal.report.version} ({proposal.report.status})
                  </Link>
                ) : (
                  <span className="text-muted-soft">Built directly from verified findings</span>
                )}
              </DefinitionRow>
            </dl>
          </Card>

          <Card
            title="Why these services"
            description="Each line traces to the verified findings that justify it."
            padded={false}
          >
            <ul className="divide-y divide-line-soft">
              {proposal.items.map((item) => {
                const refs = parseStringArray(item.sourceFindingIdsJson)
                  .map((fid) => findingById.get(fid))
                  .filter(Boolean);
                return (
                  <li key={item.id} className="px-4 py-2.5">
                    <p className="text-[13px] font-medium text-navy">{item.name}</p>
                    <p className="text-[11px] text-muted-soft">{PHASE_LABELS[item.phase] ?? item.phase}</p>
                    {refs.length === 0 ? (
                      <p className="mt-1 text-[11px] text-high">
                        Added manually — no finding is linked to this line.
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {refs.map((f) => (
                          <li key={f!.id} className="text-[11px]">
                            <Link href={`/findings/${f!.id}`} className="font-mono font-semibold text-blue hover:underline">
                              {f!.reference}
                            </Link>{' '}
                            <span className="text-muted">{f!.observation_text.slice(0, 70)}…</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Approval history" padded={false}>
            {proposal.approvals.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-soft">Not yet submitted.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {proposal.approvals.map((a) => (
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
