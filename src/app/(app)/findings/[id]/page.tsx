import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePagePermission } from '@/server/auth/guard';
import { can } from '@/server/auth/permissions';
import { getSetting } from '@/server/settings';
import { ruleFor } from '@/server/findings/rules';
import { parseJson, parseStringArray } from '@/lib/json';
import { z } from 'zod';
import {
  Badge,
  Card,
  ConfidenceBadge,
  DefinitionRow,
  Notice,
  OutcomeBadge,
  PageHeader,
  SeverityBadge,
  VerificationBadge,
  formatDate,
  relativeAge,
} from '@/components/ui';
import { FindingActions } from '@/components/finding-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await db.finding.findUnique({ where: { id }, select: { reference: true } });
  return { title: f ? f.reference : 'Finding' };
}

export default async function FindingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePagePermission('finding.read');

  const finding = await db.finding.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, legalName: true, brandName: true, website: true } },
      reviewer: { select: { name: true } },
      auditRun: { select: { id: true, engineVersion: true, createdAt: true } },
      evidence: { orderBy: { capturedAt: 'desc' } },
      observation: { include: { evidence: { orderBy: { capturedAt: 'desc' } } } },
    },
  });

  if (!finding || finding.deletedAt) notFound();

  const outreach = await getSetting('outreach.rules');
  const staleBefore = new Date(Date.now() - outreach.freshnessHours * 3600_000);
  const isStale = finding.observedAt < staleBefore;

  const rule = ruleFor(finding.checkCode);
  const services = parseStringArray(finding.recommendedServiceCodes);
  const serviceModules = services.length
    ? await db.serviceModule.findMany({ where: { code: { in: services } }, select: { code: true, name: true } })
    : [];

  const rawValue = parseJson(finding.observation?.rawValueJson, z.record(z.unknown()), {});
  const allEvidence = [...finding.evidence, ...(finding.observation?.evidence ?? [])];

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link href="/findings" className="hover:underline">Findings</Link>
            {' · '}
            <Link href={`/leads/${finding.organization.id}`} className="hover:underline">
              {finding.organization.brandName ?? finding.organization.legalName}
            </Link>
          </>
        }
        title={finding.reference}
        description={finding.observation_text}
      />

      {finding.requiresReverification && (
        <div className="mb-4">
          <Notice tone="warn" title="Imported observation — requires re-verification">
            This came from a previous review rather than a live check. Run an audit to confirm
            whether it still applies. It cannot be marked client-facing until it has been re-observed.
          </Notice>
        </div>
      )}

      {isStale && finding.verificationStatus === 'manually_verified' && (
        <div className="mb-4">
          <Notice tone="critical" title="Evidence is outside the freshness window">
            Last observed {relativeAge(finding.observedAt)}, and the window is{' '}
            {outreach.freshnessHours} hours. Re-check before using this with a client — the send
            gate will block outreach that relies on it.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Evidence — what was actually measured. Read-only by design. */}
        <div className="space-y-4">
          <Card
            title="Evidence"
            description="Recorded by the audit engine. This panel is read-only: the measurement is never edited, only its interpretation."
          >
            <dl>
              <DefinitionRow label="Check">
                <code className="rounded bg-canvas px-1 py-0.5 text-[11px]">{finding.checkCode}</code>
                {rule && <span className="ml-2 text-muted">{rule.title}</span>}
              </DefinitionRow>
              <DefinitionRow label="Evidence URL">
                {finding.evidenceUrl ? (
                  <a href={finding.evidenceUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-blue hover:underline">
                    {finding.evidenceUrl}
                  </a>
                ) : (
                  <span className="text-muted-soft">Recorded against the audit run</span>
                )}
              </DefinitionRow>
              <DefinitionRow label="Observed at">
                {formatDate(finding.observedAt, true)}{' '}
                <span className="text-muted-soft">({relativeAge(finding.observedAt)})</span>
              </DefinitionRow>
              <DefinitionRow label="Outcome">
                {finding.observation ? <OutcomeBadge outcome={finding.observation.outcome} /> : <Badge tone="muted">imported</Badge>}
              </DefinitionRow>
              <DefinitionRow label="Source">
                <Badge tone={finding.source === 'automated' ? 'blue' : 'warn'}>{finding.source}</Badge>
              </DefinitionRow>
              <DefinitionRow label="Audit run">
                {finding.auditRun ? (
                  <>
                    engine v{finding.auditRun.engineVersion} · {formatDate(finding.auditRun.createdAt, true)}
                  </>
                ) : (
                  <span className="text-muted-soft">No run (imported)</span>
                )}
              </DefinitionRow>
            </dl>

            {Object.keys(rawValue).length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Measured values
                </p>
                <pre className="max-h-56 overflow-auto rounded border border-line-soft bg-canvas p-2 text-[11px] leading-relaxed text-ink">
{JSON.stringify(rawValue, null, 2)}
                </pre>
              </div>
            )}
          </Card>

          <Card title="Captured artefacts" description={`${allEvidence.length} item(s).`} padded={false}>
            {allEvidence.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-soft">
                No artefact was captured for this finding.
              </p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {allEvidence.map((e) => (
                  <li key={e.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge tone="muted">{e.kind.replace(/_/g, ' ')}</Badge>
                      <span className="text-[11px] text-muted-soft">{formatDate(e.capturedAt, true)}</span>
                    </div>
                    {e.sourceUrl && (
                      <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 block break-all text-[11px] text-blue hover:underline">
                        {e.sourceUrl}
                      </a>
                    )}
                    {e.content && (
                      <pre className="mt-1.5 max-h-64 overflow-auto rounded border border-line-soft bg-canvas p-2 text-[11px] leading-relaxed text-ink">
{e.content}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Interpretation — editable, and what the client would read. */}
        <div className="space-y-4">
          <Card title="Current classification">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={finding.severity} />
              <ConfidenceBadge confidence={finding.confidence} />
              <VerificationBadge status={finding.verificationStatus} />
              <Badge tone="muted">{finding.category}</Badge>
              {finding.clientVisible ? (
                <Badge tone="good">approved for client-facing use</Badge>
              ) : (
                <Badge tone="muted">internal only</Badge>
              )}
            </div>

            <dl className="mt-3">
              <DefinitionRow label="Reviewer">
                {finding.reviewer?.name ?? <span className="text-muted-soft">Not yet reviewed</span>}
              </DefinitionRow>
              <DefinitionRow label="Reviewed at">{formatDate(finding.reviewedAt, true)}</DefinitionRow>
              {finding.dismissReason && (
                <DefinitionRow label="Dismiss reason">{finding.dismissReason}</DefinitionRow>
              )}
              <DefinitionRow label="Recommended services">
                {serviceModules.length === 0 ? (
                  <span className="text-muted-soft">None mapped</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {serviceModules.map((s) => (
                      <Badge key={s.code} tone="blue">{s.name}</Badge>
                    ))}
                  </span>
                )}
              </DefinitionRow>
            </dl>

            <div className="mt-3 space-y-2 rounded-md border border-line-soft bg-canvas p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                How this reads to a client
              </p>
              <p className="text-[13px] text-ink">
                <strong className="text-navy">We observed</strong> that{' '}
                {finding.observation_text.charAt(0).toLowerCase() + finding.observation_text.slice(1)}
              </p>
              <p className="text-[13px] text-ink">
                <strong className="text-navy">This may affect</strong>{' '}
                {finding.businessImpact.charAt(0).toLowerCase() + finding.businessImpact.slice(1)}
              </p>
              <p className="text-[13px] text-ink">
                <strong className="text-navy">We recommend</strong>{' '}
                {finding.recommendation.charAt(0).toLowerCase() + finding.recommendation.slice(1)}
              </p>
            </div>

            {finding.analystNote && (
              <div className="mt-3 rounded-md bg-high-bg p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-high">Analyst note (internal)</p>
                <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink">{finding.analystNote}</p>
              </div>
            )}
          </Card>

          <FindingActions
            findingId={finding.id}
            organizationId={finding.organization.id}
            verificationStatus={finding.verificationStatus}
            clientVisible={finding.clientVisible}
            requiresReverification={finding.requiresReverification}
            severity={finding.severity}
            confidence={finding.confidence}
            observationText={finding.observation_text}
            businessImpact={finding.businessImpact}
            recommendation={finding.recommendation}
            analystNote={finding.analystNote}
            permissions={{
              verify: can(user.role, 'finding.verify'),
              edit: can(user.role, 'finding.edit'),
              dismiss: can(user.role, 'finding.dismiss'),
              visibility: can(user.role, 'finding.set_visibility'),
              recheck: can(user.role, 'finding.recheck'),
            }}
          />
        </div>
      </div>
    </>
  );
}
