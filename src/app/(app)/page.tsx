import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { OPEN_STAGES, STAGE_LABELS, type PipelineStage } from '@/lib/enums';
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  ScorePill,
  StageBadge,
  StatTile,
  formatDate,
  money,
  relativeAge,
} from '@/components/ui';
import { ruleFor } from '@/server/findings/rules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const user = await requirePageUser();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [
    totalProspects,
    newProspects,
    highPriority,
    auditsInProgress,
    awaitingVerification,
    reportsAwaiting,
    proposalsAwaiting,
    emailsAwaiting,
    emailsSent,
    replies,
    meetings,
    proposalsPresented,
    won,
    lost,
    openOrgs,
    upcomingFollowUps,
    overdueTasks,
    commonIssues,
    byIndustry,
    scoreBuckets,
    topProspects,
    recentActivity,
  ] = await Promise.all([
    db.organization.count({ where: { deletedAt: null } }),
    db.organization.count({ where: { deletedAt: null, createdAt: { gte: weekAgo } } }),
    db.organization.count({ where: { deletedAt: null, opportunityScore: { gte: 90 } } }),
    db.auditRun.count({ where: { status: { in: ['queued', 'running'] } } }),
    db.finding.count({
      where: { deletedAt: null, verificationStatus: { in: ['auto_detected', 'needs_review'] } },
    }),
    db.report.count({ where: { status: 'pending_approval', deletedAt: null } }),
    db.proposal.count({ where: { status: 'pending_approval', deletedAt: null } }),
    db.emailDraft.count({ where: { status: 'needs_review', deletedAt: null } }),
    db.emailDraft.count({ where: { status: { in: ['sent', 'delivered', 'replied'] } } }),
    db.emailDraft.count({ where: { status: 'replied' } }),
    db.meeting.count({ where: { status: { in: ['scheduled', 'held'] } } }),
    db.proposal.count({ where: { status: { in: ['approved', 'presented'] }, deletedAt: null } }),
    db.organization.count({ where: { deletedAt: null, stage: 'won' } }),
    db.organization.count({ where: { deletedAt: null, stage: 'lost' } }),
    db.organization.findMany({
      where: { deletedAt: null, stage: { in: OPEN_STAGES } },
      select: { opportunityValue: true, currency: true },
    }),
    db.task.findMany({
      where: { status: 'open', dueAt: { gte: now, lte: new Date(now.getTime() + 7 * 86_400_000) } },
      orderBy: { dueAt: 'asc' },
      take: 6,
      include: { organization: { select: { id: true, legalName: true } }, owner: { select: { name: true } } },
    }),
    db.task.count({ where: { status: 'open', dueAt: { lt: now } } }),
    db.finding.groupBy({
      by: ['checkCode'],
      where: { deletedAt: null, verificationStatus: { not: 'dismissed' } },
      _count: true,
      orderBy: { _count: { checkCode: 'desc' } },
      take: 8,
    }),
    db.organization.groupBy({
      by: ['industry'],
      where: { deletedAt: null },
      _count: true,
      orderBy: { _count: { industry: 'desc' } },
      take: 8,
    }),
    db.organization.findMany({
      where: { deletedAt: null, opportunityScore: { not: null } },
      select: { opportunityScore: true },
    }),
    db.organization.findMany({
      where: { deletedAt: null, opportunityScore: { not: null }, stage: { notIn: ['won', 'lost'] } },
      orderBy: { opportunityScore: 'desc' },
      take: 8,
      select: {
        id: true,
        legalName: true,
        brandName: true,
        industry: true,
        stage: true,
        opportunityScore: true,
        confidenceScore: true,
        website: true,
        _count: { select: { findings: true } },
      },
    }),
    db.activity.findMany({
      orderBy: { occurredAt: 'desc' },
      take: 10,
      include: { actor: { select: { name: true } }, organization: { select: { id: true, legalName: true } } },
    }),
  ]);

  const pipelineValue = openOrgs.reduce((sum, o) => sum + (o.opportunityValue ?? 0), 0);
  const closedTotal = won + lost;
  const winRate = closedTotal > 0 ? Math.round((won / closedTotal) * 100) : null;
  const replyRate = emailsSent > 0 ? Math.round((replies / emailsSent) * 100) : null;

  const bands = [
    { label: '95-100 · Immediate outreach', min: 95, max: 100 },
    { label: '90-94 · Strong prospect', min: 90, max: 94 },
    { label: '80-89 · Good opportunity', min: 80, max: 89 },
    { label: 'Below 80 · Nurture', min: 0, max: 79 },
  ].map((b) => ({
    ...b,
    count: scoreBuckets.filter((o) => (o.opportunityScore ?? 0) >= b.min && (o.opportunityScore ?? 0) <= b.max).length,
  }));

  return (
    <>
      <PageHeader
        title={`Good day, ${user.name.split(' ')[0]}`}
        description="Priority prospects, work waiting for review, and outreach performance."
      />

      <section aria-labelledby="prospect-metrics" className="mb-6">
        <h2 id="prospect-metrics" className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Prospects
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Total prospects" value={totalProspects} href="/leads" />
          <StatTile label="New this week" value={newProspects} href="/leads?sort=newest" />
          <StatTile
            label="High priority"
            value={highPriority}
            hint="Score 90 or above"
            tone={highPriority > 0 ? 'attention' : 'neutral'}
            href="/leads?minScore=90"
          />
          <StatTile label="Audits in progress" value={auditsInProgress} />
          <StatTile
            label="Awaiting verification"
            value={awaitingVerification}
            tone={awaitingVerification > 0 ? 'attention' : 'neutral'}
            href="/findings"
          />
          <StatTile label="Pipeline value" value={money(pipelineValue)} hint={`${openOrgs.length} open`} href="/pipeline" />
        </div>
      </section>

      <section aria-labelledby="queue-metrics" className="mb-6">
        <h2 id="queue-metrics" className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Waiting for a decision
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            label="Reports awaiting approval"
            value={reportsAwaiting}
            tone={reportsAwaiting > 0 ? 'attention' : 'neutral'}
            href="/approvals"
          />
          <StatTile
            label="Proposals awaiting approval"
            value={proposalsAwaiting}
            tone={proposalsAwaiting > 0 ? 'attention' : 'neutral'}
            href="/approvals"
          />
          <StatTile
            label="Emails awaiting approval"
            value={emailsAwaiting}
            tone={emailsAwaiting > 0 ? 'attention' : 'neutral'}
            href="/approvals"
          />
          <StatTile
            label="Overdue tasks"
            value={overdueTasks}
            tone={overdueTasks > 0 ? 'critical' : 'good'}
            href="/tasks?filter=overdue"
          />
        </div>
      </section>

      <section aria-labelledby="outreach-metrics" className="mb-6">
        <h2 id="outreach-metrics" className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Outreach and conversion
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Emails sent" value={emailsSent} href="/emails" />
          <StatTile label="Replies received" value={replies} hint={replyRate === null ? 'No sends yet' : `${replyRate}% reply rate`} />
          <StatTile label="Meetings booked" value={meetings} />
          <StatTile label="Proposals presented" value={proposalsPresented} href="/proposals" />
          <StatTile label="Won" value={won} tone="good" hint={winRate === null ? undefined : `${winRate}% win rate`} />
          <StatTile label="Lost" value={lost} tone={lost > 0 ? 'critical' : 'neutral'} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card
          title="Priority prospects"
          description="Ranked by opportunity score. Confidence is shown separately so a strong score never hides weak evidence."
          padded={false}
          action={
            <Link href="/leads" className="text-xs font-semibold text-blue hover:underline">
              All leads
            </Link>
          }
        >
          {topProspects.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No scored prospects yet"
                description="Add a prospect and run an audit. Scores appear once findings have been verified."
                action={
                  <Link href="/leads/new" className="text-xs font-semibold text-blue hover:underline">
                    Add a prospect
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Organization</th>
                    <th scope="col">Stage</th>
                    <th scope="col" className="text-right">Findings</th>
                    <th scope="col" className="text-right">Confidence</th>
                    <th scope="col" className="text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {topProspects.map((org) => (
                    <tr key={org.id}>
                      <td>
                        <Link href={`/leads/${org.id}`} className="font-semibold text-navy hover:text-blue hover:underline">
                          {org.brandName ?? org.legalName}
                        </Link>
                        <div className="text-[11px] text-muted-soft">
                          {org.industry ?? 'Industry not recorded'}
                        </div>
                      </td>
                      <td><StageBadge stage={org.stage} /></td>
                      <td className="text-right numeric">{org._count.findings}</td>
                      <td className="text-right numeric">
                        {org.confidenceScore === null ? (
                          <span className="text-muted-soft">—</span>
                        ) : (
                          <span className={org.confidenceScore < 50 ? 'font-semibold text-high' : ''}>
                            {org.confidenceScore}
                          </span>
                        )}
                      </td>
                      <td className="text-right"><ScorePill score={org.opportunityScore} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Prospects by score band">
            <ul className="space-y-2">
              {bands.map((band) => {
                const pct = scoreBuckets.length > 0 ? (band.count / scoreBuckets.length) * 100 : 0;
                return (
                  <li key={band.label}>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-ink">{band.label}</span>
                      <span className="font-semibold tabular-nums text-navy">{band.count}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line-soft">
                      <div
                        className="h-full rounded-full bg-blue"
                        style={{ width: `${Math.max(pct, band.count > 0 ? 3 : 0)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            {scoreBuckets.length === 0 && (
              <p className="mt-2 text-xs text-muted-soft">No prospects have been scored yet.</p>
            )}
          </Card>

          <Card title="Upcoming follow-ups" description="Due in the next seven days.">
            {upcomingFollowUps.length === 0 ? (
              <p className="text-xs text-muted-soft">Nothing scheduled in the next seven days.</p>
            ) : (
              <ul className="space-y-2">
                {upcomingFollowUps.map((task) => (
                  <li key={task.id} className="flex items-start justify-between gap-3 border-b border-line-soft pb-2 last:border-b-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">{task.title}</p>
                      <p className="text-[11px] text-muted-soft">
                        {task.organization ? (
                          <Link href={`/leads/${task.organization.id}`} className="hover:underline">
                            {task.organization.legalName}
                          </Link>
                        ) : (
                          'No organization'
                        )}
                        {task.owner ? ` · ${task.owner.name}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted">{formatDate(task.dueAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Most common website problems" description="Across all prospects, excluding dismissed findings.">
          {commonIssues.length === 0 ? (
            <p className="text-xs text-muted-soft">No findings recorded yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {commonIssues.map((row) => {
                const rule = ruleFor(row.checkCode);
                return (
                  <li key={row.checkCode} className="flex items-start justify-between gap-3 text-[13px]">
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{rule?.title ?? row.checkCode}</span>
                      <code className="text-[10px] text-muted-soft">{row.checkCode}</code>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-navy">{row._count}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Prospects by industry">
          {byIndustry.length === 0 ? (
            <p className="text-xs text-muted-soft">No prospects recorded yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {byIndustry.map((row) => (
                <li key={row.industry ?? 'unknown'} className="flex items-center justify-between text-[13px]">
                  <span className="truncate text-ink">{row.industry ?? 'Not recorded'}</span>
                  <span className="font-semibold tabular-nums text-navy">{row._count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Recent activity"
          action={<Link href="/logs" className="text-xs font-semibold text-blue hover:underline">Full log</Link>}
        >
          {recentActivity.length === 0 ? (
            <p className="text-xs text-muted-soft">No activity recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentActivity.map((a) => (
                <li key={a.id} className="text-[12px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <Badge tone="muted">{a.action}</Badge>
                    <span className="shrink-0 text-[11px] text-muted-soft">{relativeAge(a.occurredAt)}</span>
                  </div>
                  <p className="mt-0.5 text-muted">
                    {a.actor?.name ?? 'System'}
                    {a.organization ? (
                      <>
                        {' · '}
                        <Link href={`/leads/${a.organization.id}`} className="hover:underline">
                          {a.organization.legalName}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

