import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requirePagePermission } from '@/server/auth/guard';
import { getSetting } from '@/server/settings';
import {
  FINDING_CATEGORIES,
  SEVERITIES,
  VERIFICATION_STATUSES,
  VERIFICATION_LABELS,
} from '@/lib/enums';
import {
  Badge,
  Card,
  ConfidenceBadge,
  EmptyState,
  PageHeader,
  SeverityBadge,
  VerificationBadge,
  formatDate,
  inputClass,
  relativeAge,
} from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Findings review' };

const PAGE_SIZE = 50;

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePagePermission('finding.read');
  const params = await searchParams;

  const orgId = params.org ?? '';
  const status = params.status ?? 'open';
  const severity = params.severity ?? '';
  const category = params.category ?? '';
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  const outreach = await getSetting('outreach.rules');
  const staleBefore = new Date(Date.now() - outreach.freshnessHours * 3600_000);

  const where: Prisma.FindingWhereInput = {
    deletedAt: null,
    ...(orgId ? { organizationId: orgId } : {}),
    ...(severity ? { severity } : {}),
    ...(category ? { category } : {}),
    ...(status === 'open'
      ? { verificationStatus: { in: ['auto_detected', 'needs_review'] } }
      : status === 'client_visible'
        ? { clientVisible: true }
        : status === 'stale'
          ? { verificationStatus: 'manually_verified', observedAt: { lt: staleBefore } }
          : status && status !== 'all'
            ? { verificationStatus: status }
            : {}),
  };

  const [total, findings, org, statusCounts] = await Promise.all([
    db.finding.count({ where }),
    db.finding.findMany({
      where,
      orderBy: [{ severity: 'asc' }, { observedAt: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        organization: { select: { id: true, legalName: true, brandName: true, website: true } },
        reviewer: { select: { name: true } },
      },
    }),
    orgId ? db.organization.findUnique({ where: { id: orgId }, select: { legalName: true, brandName: true } }) : null,
    db.finding.groupBy({
      by: ['verificationStatus'],
      where: { deletedAt: null, ...(orgId ? { organizationId: orgId } : {}) },
      _count: true,
    }),
  ]);

  const counts = new Map(statusCounts.map((s) => [s.verificationStatus, s._count]));
  const openCount = (counts.get('auto_detected') ?? 0) + (counts.get('needs_review') ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /**
   * Group the page of findings by organization, preserving the severity order
   * the query returned. Grouping happens after pagination so the page size
   * still means "50 findings", not "50 companies".
   */
  const groupMap = new Map<
    string,
    { organization: (typeof findings)[number]['organization']; findings: typeof findings }
  >();
  for (const finding of findings) {
    const existing = groupMap.get(finding.organization.id);
    if (existing) existing.findings.push(finding);
    else groupMap.set(finding.organization.id, { organization: finding.organization, findings: [finding] });
  }
  // Most findings first: the companies with the most work to review.
  const grouped = [...groupMap.values()].sort((a, b) => b.findings.length - a.findings.length);

  const href = (next: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ org: orgId, status, severity, category, ...next })) {
      if (v !== undefined && v !== '' && v !== null) sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? `/findings?${s}` : '/findings';
  };

  return (
    <>
      <PageHeader
        breadcrumb={org ? <Link href={`/leads/${orgId}`} className="hover:underline">{org.brandName ?? org.legalName}</Link> : undefined}
        title="Findings review"
        description="Verify each finding against its evidence before it can be used with a client. Nothing here is client-facing until a person marks it so."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link href={href({ status: 'open', page: 1 })} className="rounded-lg border border-line bg-white px-3 py-2 hover:border-blue-100">
          <div className="text-[11px] uppercase tracking-wide text-muted">Awaiting review</div>
          <div className={`text-xl font-semibold tabular-nums ${openCount > 0 ? 'text-high' : 'text-navy'}`}>{openCount}</div>
        </Link>
        <Link href={href({ status: 'manually_verified', page: 1 })} className="rounded-lg border border-line bg-white px-3 py-2 hover:border-blue-100">
          <div className="text-[11px] uppercase tracking-wide text-muted">Verified</div>
          <div className="text-xl font-semibold tabular-nums text-navy">{counts.get('manually_verified') ?? 0}</div>
        </Link>
        <Link href={href({ status: 'client_visible', page: 1 })} className="rounded-lg border border-line bg-white px-3 py-2 hover:border-blue-100">
          <div className="text-[11px] uppercase tracking-wide text-muted">Client-facing</div>
          <div className="text-xl font-semibold tabular-nums text-good">{await db.finding.count({ where: { deletedAt: null, clientVisible: true, ...(orgId ? { organizationId: orgId } : {}) } })}</div>
        </Link>
        <Link href={href({ status: 'stale', page: 1 })} className="rounded-lg border border-line bg-white px-3 py-2 hover:border-blue-100">
          <div className="text-[11px] uppercase tracking-wide text-muted">Stale evidence</div>
          <div className="text-xl font-semibold tabular-nums text-critical">
            {await db.finding.count({
              where: { deletedAt: null, verificationStatus: 'manually_verified', observedAt: { lt: staleBefore }, ...(orgId ? { organizationId: orgId } : {}) },
            })}
          </div>
        </Link>
      </div>

      <Card className="mb-4">
        <form method="get" className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
          {orgId && <input type="hidden" name="org" value={orgId} />}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Status</span>
            <select name="status" defaultValue={status} className={inputClass}>
              <option value="open">Awaiting review</option>
              <option value="all">All statuses</option>
              <option value="client_visible">Client-facing</option>
              <option value="stale">Stale evidence</option>
              {VERIFICATION_STATUSES.map((s) => (
                <option key={s} value={s}>{VERIFICATION_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Severity</span>
            <select name="severity" defaultValue={severity} className={inputClass}>
              <option value="">All severities</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Category</span>
            <select name="category" defaultValue={category} className={inputClass}>
              <option value="">All categories</option>
              {FINDING_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button type="submit" className="rounded-md bg-navy px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-blue">
            Filter
          </button>
        </form>
      </Card>

      {findings.length === 0 ? (
        <Card>
          <EmptyState
            title="No findings match these filters"
            description="Findings appear here after an audit run produces evidence for a catalogued issue."
          />
        </Card>
      ) : (
        <>
          {/*
            Grouped by organization. A flat list repeats the company name on
            every row, which makes it hard to see how much work one prospect
            actually represents — and reviewing is done a company at a time.
          */}
          <div className="space-y-4">
            {grouped.map((group) => {
              const counts = {
                critical: group.findings.filter((f) => f.severity === 'critical').length,
                high: group.findings.filter((f) => f.severity === 'high').length,
                medium: group.findings.filter((f) => f.severity === 'medium').length,
                low: group.findings.filter((f) => f.severity === 'low').length,
              };
              const awaiting = group.findings.filter((f) =>
                ['auto_detected', 'needs_review'].includes(f.verificationStatus),
              ).length;

              return (
                <Card
                  key={group.organization.id}
                  padded={false}
                  title={
                    <Link
                      href={`/leads/${group.organization.id}`}
                      className="text-[14px] font-semibold text-navy hover:text-blue hover:underline"
                    >
                      {group.organization.brandName ?? group.organization.legalName}
                    </Link>
                  }
                  description={
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>
                        {group.findings.length} finding{group.findings.length === 1 ? '' : 's'}
                        {awaiting > 0 && ` · ${awaiting} awaiting review`}
                      </span>
                      {group.organization.website && (
                        <a
                          href={group.organization.website}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="text-blue hover:underline"
                        >
                          {group.organization.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      )}
                    </span>
                  }
                  action={
                    <div className="flex flex-wrap items-center gap-1.5">
                      {counts.critical > 0 && <Badge tone="critical">{counts.critical} critical</Badge>}
                      {counts.high > 0 && <Badge tone="warn">{counts.high} high</Badge>}
                      {counts.medium > 0 && <Badge tone="blue">{counts.medium} medium</Badge>}
                      {counts.low > 0 && <Badge tone="neutral">{counts.low} low</Badge>}
                      <Link
                        href={`/findings?org=${group.organization.id}`}
                        className="ml-1 text-xs font-semibold text-blue hover:underline"
                      >
                        Review all
                      </Link>
                    </div>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">Reference</th>
                          <th scope="col">Observation</th>
                          <th scope="col">Severity</th>
                          <th scope="col">Status</th>
                          <th scope="col">Reviewer</th>
                          <th scope="col">Observed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.findings.map((f) => {
                          const stale = f.observedAt < staleBefore;
                          return (
                            <tr key={f.id}>
                              <td>
                                <Link
                                  href={`/findings/${f.id}`}
                                  className="font-mono text-[11px] font-semibold text-blue hover:underline"
                                >
                                  {f.reference}
                                </Link>
                              </td>
                              <td className="max-w-xl">
                                <Link href={`/findings/${f.id}`} className="line-clamp-2 text-ink hover:text-blue">
                                  {f.observation_text}
                                </Link>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <Badge tone="muted">{f.category}</Badge>
                                  <ConfidenceBadge confidence={f.confidence} />
                                  {f.clientVisible && <Badge tone="good">client-facing</Badge>}
                                  {f.requiresReverification && <Badge tone="warn">re-verify</Badge>}
                                  {stale && f.verificationStatus === 'manually_verified' && (
                                    <Badge tone="critical">stale</Badge>
                                  )}
                                </div>
                              </td>
                              <td><SeverityBadge severity={f.severity} /></td>
                              <td><VerificationBadge status={f.verificationStatus} /></td>
                              <td className="text-[12px] text-muted">{f.reviewer?.name ?? '—'}</td>
                              <td
                                className="whitespace-nowrap text-[12px] text-muted"
                                title={formatDate(f.observedAt, true)}
                              >
                                {relativeAge(f.observedAt)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })}
          </div>

          {pages > 1 && (
            <nav
              aria-label="Pagination"
              className="mt-4 flex items-center justify-between rounded-lg border border-line bg-white px-4 py-2.5 text-xs"
            >
              <span className="text-muted">
                Page {page} of {pages} · {total} findings across {grouped.length} organization
                {grouped.length === 1 ? '' : 's'}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link href={href({ page: page - 1 })} className="font-semibold text-blue hover:underline">
                    Previous
                  </Link>
                )}
                {page < pages && (
                  <Link href={href({ page: page + 1 })} className="font-semibold text-blue hover:underline">
                    Next
                  </Link>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </>
  );
}
