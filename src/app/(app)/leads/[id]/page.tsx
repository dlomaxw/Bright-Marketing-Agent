import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { can } from '@/server/auth/permissions';
import { parseStringArray } from '@/lib/json';
import { PLATFORM_LABELS, STAGE_LABELS, type Platform } from '@/lib/enums';
import { getSetting } from '@/server/settings';
import {
  Badge,
  Card,
  ConfidenceBadge,
  DefinitionRow,
  EmptyState,
  Notice,
  PageHeader,
  ScorePill,
  SeverityBadge,
  StageBadge,
  VerificationBadge,
  buttonClass,
  formatDate,
  money,
  relativeAge,
} from '@/components/ui';
import { ScoreExplainer } from '@/components/score-explainer';
import { RunAuditPanel } from '@/components/run-audit-panel';
import { StageControl } from '@/components/stage-control';
import { GenerateActions } from '@/components/generate-actions';
import { SocialResearch } from '@/components/social-research';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await db.organization.findUnique({ where: { id }, select: { legalName: true, brandName: true } });
  return { title: org ? (org.brandName ?? org.legalName) : 'Lead' };
}

export default async function LeadWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser();

  const org = await db.organization.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true } },
      contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
      profiles: { orderBy: { platform: 'asc' } },
      auditRuns: { orderBy: { createdAt: 'desc' }, take: 5, include: { jobs: true } },
      findings: { where: { deletedAt: null }, orderBy: [{ severity: 'asc' }, { observedAt: 'desc' }] },
      reports: { where: { deletedAt: null }, orderBy: { version: 'desc' } },
      proposals: { where: { deletedAt: null }, orderBy: { version: 'desc' } },
      emailDrafts: { where: { deletedAt: null }, orderBy: { version: 'desc' } },
      tasks: { where: { status: 'open' }, orderBy: { dueAt: 'asc' } },
      meetings: { orderBy: { scheduledFor: 'desc' }, take: 5 },
      activities: {
        orderBy: { occurredAt: 'desc' },
        take: 20,
        include: { actor: { select: { name: true } } },
      },
    },
  });

  if (!org || org.deletedAt) notFound();

  const outreach = await getSetting('outreach.rules');
  const staleBefore = new Date(Date.now() - outreach.freshnessHours * 3600_000);

  const tags = parseStringArray(org.tagsJson);
  const verified = org.findings.filter((f) => f.verificationStatus === 'manually_verified');
  const pending = org.findings.filter((f) =>
    ['auto_detected', 'needs_review'].includes(f.verificationStatus),
  );
  const clientVisible = verified.filter((f) => f.clientVisible);
  const stale = clientVisible.filter((f) => f.observedAt < staleBefore);
  const needsReverification = org.findings.filter((f) => f.requiresReverification);

  const latestRun = org.auditRuns[0];
  const displayName = org.brandName ?? org.legalName;

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/leads" className="hover:underline">Leads</Link>}
        title={displayName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {org.website ? (
              <a href={org.website} target="_blank" rel="noopener noreferrer nofollow" className="text-blue hover:underline">
                {org.website}
              </a>
            ) : (
              <span className="text-muted-soft">No website recorded</span>
            )}
            <span className="text-muted-soft">·</span>
            <span>{[org.city, org.country].filter(Boolean).join(', ')}</span>
            {org.industry && (
              <>
                <span className="text-muted-soft">·</span>
                <span>{org.industry}</span>
              </>
            )}
          </span>
        }
        actions={
          <>
            <StageControl
              organizationId={org.id}
              stage={org.stage}
              canEdit={can(user.role, 'pipeline.update_stage')}
            />
            {can(user.role, 'org.update') && (
              <Link href={`/leads/${org.id}/edit`} className={buttonClass('secondary')}>
                Edit
              </Link>
            )}
          </>
        }
      />

      {org.isDemoData && (
        <div className="mb-4">
          <Notice tone="warn" title="Demonstration record">
            This organization is seeded demonstration data on a reserved domain that cannot resolve to
            a real website. It exists to exercise the workflow. Do not use it for outreach.
          </Notice>
        </div>
      )}

      {needsReverification.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn" title={`${needsReverification.length} imported finding(s) require re-verification`}>
            Imported observations are historical. Run an audit to confirm whether they still apply
            before any of them is used in a report, a proposal or an email.
          </Notice>
        </div>
      )}

      {stale.length > 0 && (
        <div className="mb-4">
          <Notice tone="critical" title={`${stale.length} client-facing finding(s) are outside the freshness window`}>
            These were last observed more than {outreach.freshnessHours} hours ago. Re-check them
            before contacting this organization — the send gate will block outreach that relies on
            them.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <RunAuditPanel
            organizationId={org.id}
            website={org.website}
            latestRun={
              latestRun
                ? {
                    id: latestRun.id,
                    status: latestRun.status,
                    createdAt: latestRun.createdAt.toISOString(),
                    completedAt: latestRun.completedAt?.toISOString() ?? null,
                    jobs: latestRun.jobs.map((j) => ({
                      group: j.groupCode,
                      status: j.status,
                      error: j.error,
                    })),
                  }
                : null
            }
            canRun={can(user.role, 'audit.run')}
            hasProfiles={org.profiles.length > 0}
          />

          <Card
            title="Findings"
            description={`${verified.length} verified · ${pending.length} awaiting review · ${clientVisible.length} approved for client-facing use`}
            padded={false}
            action={
              <Link href={`/findings?org=${org.id}`} className="text-xs font-semibold text-blue hover:underline">
                Review evidence
              </Link>
            }
          >
            {org.findings.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No findings yet"
                  description="Run an audit to collect evidence. Findings are only created where a check produced evidence for a catalogued issue."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Reference</th>
                      <th scope="col">Observation</th>
                      <th scope="col">Severity</th>
                      <th scope="col">Status</th>
                      <th scope="col">Observed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {org.findings.slice(0, 15).map((f) => (
                      <tr key={f.id}>
                        <td>
                          <Link href={`/findings/${f.id}`} className="font-mono text-[11px] font-semibold text-blue hover:underline">
                            {f.reference}
                          </Link>
                        </td>
                        <td className="max-w-md">
                          <span className="line-clamp-2 text-ink">{f.observation_text}</span>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge tone="muted">{f.category}</Badge>
                            <ConfidenceBadge confidence={f.confidence} />
                            {f.clientVisible && <Badge tone="good">client-facing</Badge>}
                            {f.requiresReverification && <Badge tone="warn">re-verify</Badge>}
                          </div>
                        </td>
                        <td><SeverityBadge severity={f.severity} /></td>
                        <td><VerificationBadge status={f.verificationStatus} /></td>
                        <td className="whitespace-nowrap text-[12px] text-muted" title={formatDate(f.observedAt, true)}>
                          {relativeAge(f.observedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {org.findings.length > 15 && (
                  <p className="border-t border-line-soft px-4 py-2 text-xs text-muted">
                    Showing 15 of {org.findings.length}.{' '}
                    <Link href={`/findings?org=${org.id}`} className="font-semibold text-blue hover:underline">
                      See all findings
                    </Link>
                  </p>
                )}
              </div>
            )}
          </Card>

          <GenerateActions
            organizationId={org.id}
            clientVisibleCount={clientVisible.length}
            reports={org.reports.map((r) => ({
              id: r.id,
              version: r.version,
              status: r.status,
              createdAt: r.createdAt.toISOString(),
            }))}
            proposals={org.proposals.map((p) => ({
              id: p.id,
              version: p.version,
              status: p.status,
              total: p.total,
              currency: p.currency,
            }))}
            emails={org.emailDrafts.map((e) => ({
              id: e.id,
              version: e.version,
              status: e.status,
              subject: e.subject,
            }))}
            permissions={{
              report: can(user.role, 'report.create'),
              proposal: can(user.role, 'proposal.create'),
              email: can(user.role, 'email.draft'),
            }}
          />

          <Card title="Contacts" description="Every contact records where the details came from." padded={false}
            action={
              can(user.role, 'contact.write') ? (
                <Link href={`/leads/${org.id}/contacts/new`} className="text-xs font-semibold text-blue hover:underline">
                  Add contact
                </Link>
              ) : undefined
            }
          >
            {org.contacts.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No contacts recorded"
                  description="A verified contact with a recorded public source is required before any email can be approved."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Role</th>
                      <th scope="col">Email</th>
                      <th scope="col">Phone</th>
                      <th scope="col">Verification</th>
                      <th scope="col">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {org.contacts.map((c) => (
                      <tr key={c.id} className={c.optedOut ? 'opacity-60' : undefined}>
                        <td className="font-medium text-navy">
                          {c.name}
                          {c.isPrimary && <Badge tone="blue">primary</Badge>}
                        </td>
                        <td className="text-muted">{c.role ?? '—'}</td>
                        <td className="text-muted">{c.email ?? '—'}</td>
                        <td className="text-muted">{c.phone ?? '—'}</td>
                        <td>
                          {c.optedOut ? (
                            <Badge tone="critical">opted out {formatDate(c.optOutAt)}</Badge>
                          ) : c.verificationStatus === 'verified' ? (
                            <Badge tone="good">verified</Badge>
                          ) : c.verificationStatus === 'outdated' ? (
                            <Badge tone="warn">outdated</Badge>
                          ) : (
                            <Badge tone="warn">unverified</Badge>
                          )}
                        </td>
                        <td className="max-w-[180px]">
                          {c.sourceUrl ? (
                            <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-blue hover:underline">
                              {c.sourceUrl}
                            </a>
                          ) : (
                            <span className="text-muted-soft">Not recorded</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <SocialResearch organizationId={org.id} canRun={can(user.role, 'audit.run')} />

          <Card
            title="Public platform profiles"
            description="Social and Google Business reviews are completed manually against a structured checklist."
            padded={false}
            action={
              can(user.role, 'org.update') ? (
                <Link href={`/leads/${org.id}/edit#platforms`} className="text-xs font-semibold text-blue hover:underline">
                  Manage
                </Link>
              ) : undefined
            }
          >
            {org.profiles.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No platform profiles recorded"
                  description="Add the public Facebook, Instagram, LinkedIn, X, TikTok, YouTube or Google Business URLs to enable the social and local review."
                />
              </div>
            ) : (
              <ul className="divide-y divide-line-soft">
                {org.profiles.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-navy">
                        {PLATFORM_LABELS[p.platform as Platform] ?? p.platform}
                      </p>
                      <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-[12px] text-blue hover:underline">
                        {p.url}
                      </a>
                    </div>
                    <div className="shrink-0 text-right">
                      <Link
                        href={`/leads/${org.id}/platforms/${p.id}`}
                        className="text-xs font-semibold text-blue hover:underline"
                      >
                        {p.lastCheckedAt ? (
                          <Badge tone="good">reviewed {formatDate(p.lastCheckedAt)}</Badge>
                        ) : (
                          'Complete review'
                        )}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <ScoreExplainer
            opportunityScore={org.opportunityScore}
            confidenceScore={org.confidenceScore}
            relationshipRisk={org.relationshipRisk}
            breakdownJson={org.scoreBreakdownJson}
            scoredAt={org.scoredAt?.toISOString() ?? null}
          />

          <Card title="Record">
            <dl>
              <DefinitionRow label="Legal name">{org.legalName}</DefinitionRow>
              <DefinitionRow label="Stage"><StageBadge stage={org.stage} /></DefinitionRow>
              <DefinitionRow label="Owner">{org.owner?.name ?? <span className="text-muted-soft">Unassigned</span>}</DefinitionRow>
              <DefinitionRow label="Sector">
                {org.sector === 'standard' ? 'Standard' : <Badge tone="warn">{org.sector} — senior approval</Badge>}
              </DefinitionRow>
              <DefinitionRow label="Source">
                {org.source}
                {org.sourceUrl && (
                  <>
                    {' · '}
                    <a href={org.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-blue hover:underline">
                      source
                    </a>
                  </>
                )}
              </DefinitionRow>
              <DefinitionRow label="Opportunity value">{money(org.opportunityValue, org.currency)}</DefinitionRow>
              <DefinitionRow label="Probability">{org.probability !== null ? `${org.probability}%` : '—'}</DefinitionRow>
              <DefinitionRow label="Last contacted">{formatDate(org.lastContactedAt)}</DefinitionRow>
              <DefinitionRow label="Next follow-up">{formatDate(org.nextFollowUpAt)}</DefinitionRow>
              <DefinitionRow label="Tags">
                {tags.length === 0 ? (
                  <span className="text-muted-soft">None</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {tags.map((t) => (
                      <Badge key={t} tone="muted">{t}</Badge>
                    ))}
                  </span>
                )}
              </DefinitionRow>
              {org.importedScore !== null && (
                <DefinitionRow label="Imported score">
                  {org.importedScore}{' '}
                  <span className="text-[11px] text-muted-soft">(advisory; recalculated after audit)</span>
                </DefinitionRow>
              )}
            </dl>
            {org.notes && (
              <div className="mt-3 rounded-md bg-canvas p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Internal notes</p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink">{org.notes}</p>
              </div>
            )}
          </Card>

          <Card title="Open tasks" action={<Link href="/tasks" className="text-xs font-semibold text-blue hover:underline">All tasks</Link>}>
            {org.tasks.length === 0 ? (
              <p className="text-xs text-muted-soft">No open tasks.</p>
            ) : (
              <ul className="space-y-2">
                {org.tasks.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-2 text-[13px]">
                    <span className="min-w-0 truncate">{t.title}</span>
                    <span
                      className={`shrink-0 text-[11px] ${t.dueAt && t.dueAt < new Date() ? 'font-semibold text-critical' : 'text-muted'}`}
                    >
                      {formatDate(t.dueAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Timeline" description="Every recorded action on this organization.">
            {org.activities.length === 0 ? (
              <p className="text-xs text-muted-soft">Nothing recorded yet.</p>
            ) : (
              <ol className="space-y-2.5">
                {org.activities.map((a) => (
                  <li key={a.id} className="border-l-2 border-line pl-3 text-[12px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-navy">{a.action}</span>
                      <span className="shrink-0 text-[11px] text-muted-soft" title={formatDate(a.occurredAt, true)}>
                        {relativeAge(a.occurredAt)}
                      </span>
                    </div>
                    <p className="text-muted">{a.actor?.name ?? 'System'}</p>
                    {a.reason && <p className="mt-0.5 text-muted-soft">{a.reason}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}

