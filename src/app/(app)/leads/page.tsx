import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { can } from '@/server/auth/permissions';
import { PIPELINE_STAGES, STAGE_LABELS } from '@/lib/enums';
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  buttonClass,
  ScorePill,
  StageBadge,
  formatDate,
  inputClass,
  relativeAge,
} from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leads and prospects' };

const PAGE_SIZE = 40;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePageUser();
  const params = await searchParams;

  const q = params.q?.trim() ?? '';
  const stage = params.stage ?? '';
  const industry = params.industry ?? '';
  const owner = params.owner ?? '';
  const minScore = Number(params.minScore ?? '');
  const sort = params.sort ?? 'score';
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  const where: Prisma.OrganizationWhereInput = {
    deletedAt: null,
    ...(stage ? { stage } : {}),
    ...(industry ? { industry } : {}),
    ...(owner ? { ownerId: owner } : {}),
    ...(Number.isFinite(minScore) && minScore > 0 ? { opportunityScore: { gte: minScore } } : {}),
    ...(q
      ? {
          OR: [
            { legalName: { contains: q } },
            { brandName: { contains: q } },
            { website: { contains: q } },
            { city: { contains: q } },
            { industry: { contains: q } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.OrganizationOrderByWithRelationInput =
    sort === 'newest'
      ? { createdAt: 'desc' }
      : sort === 'name'
        ? { legalName: 'asc' }
        : sort === 'activity'
          ? { updatedAt: 'desc' }
          : { opportunityScore: 'desc' };

  const [total, organizations, industries, owners, stageCounts] = await Promise.all([
    db.organization.count({ where }),
    db.organization.findMany({
      where,
      orderBy: [orderBy, { legalName: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { findings: true, contacts: true } },
      },
    }),
    db.organization.groupBy({
      by: ['industry'],
      where: { deletedAt: null, industry: { not: null } },
      _count: true,
      orderBy: { _count: { industry: 'desc' } },
      take: 30,
    }),
    db.user.findMany({ where: { status: 'active', deletedAt: null }, select: { id: true, name: true } }),
    db.organization.groupBy({ by: ['stage'], where: { deletedAt: null }, _count: true }),
  ]);

  const stageCount = new Map(stageCounts.map((s) => [s.stage, s._count]));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const buildHref = (next: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { q, stage, industry, owner, minScore: params.minScore, sort, ...next };
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== '' && v !== null) sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? `/leads?${s}` : '/leads';
  };

  // The current filters as a query string, so the CSV matches the screen.
  const filterQuery = (() => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, stage, industry, owner, minScore: params.minScore })) {
      if (v !== undefined && v !== '' && v !== null) sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? '?' + s : '';
  })();

  return (
    <>
      <PageHeader
        title="Leads and prospects"
        description={`${total} organization${total === 1 ? '' : 's'} matching the current filters.`}
        actions={
          <>
            {/*
              A plain anchor, not next/link: this is a file download from an API
              route, and the client router would try to navigate to it.
              It carries the current filters so the export matches what is shown.
            */}
            <a href={`/api/leads/export${filterQuery}`} className={buttonClass('secondary')}>
              Export CSV
            </a>
            {can(user.role, 'org.import') && <LinkButton href="/leads/import">Import</LinkButton>}
            {can(user.role, 'org.create') && (
              <LinkButton href="/leads/new" variant="primary">
                Add prospect
              </LinkButton>
            )}
          </>
        }
      />

      <Card className="mb-4">
        <form method="get" className="grid gap-3 md:grid-cols-[1.6fr_1fr_1fr_1fr_auto] md:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Search</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Name, website, city or industry"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Stage</span>
            <select name="stage" defaultValue={stage} className={inputClass}>
              <option value="">All stages</option>
              {PIPELINE_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]} ({stageCount.get(s) ?? 0})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Industry</span>
            <select name="industry" defaultValue={industry} className={inputClass}>
              <option value="">All industries</option>
              {industries.map((i) => (
                <option key={i.industry ?? ''} value={i.industry ?? ''}>
                  {i.industry} ({i._count})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-navy">Owner</span>
            <select name="owner" defaultValue={owner} className={inputClass}>
              <option value="">Anyone</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button type="submit" className="rounded-md bg-navy px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-blue">
              Filter
            </button>
            <Link href="/leads" className="rounded-md border border-line px-3 py-1.5 text-[13px] font-semibold text-navy hover:bg-canvas">
              Reset
            </Link>
          </div>
          <input type="hidden" name="sort" value={sort} />
        </form>
      </Card>

      <Card padded={false}>
        {organizations.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No prospects match these filters"
              description={
                total === 0 && !q && !stage
                  ? 'Add a prospect manually, or import a list to get started.'
                  : 'Try widening the filters, or reset them.'
              }
              action={
                can(user.role, 'org.create') ? (
                  <Link href="/leads/new" className="text-xs font-semibold text-blue hover:underline">
                    Add a prospect
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <Link href={buildHref({ sort: 'name', page: 1 })} className="hover:text-navy">Organization</Link>
                    </th>
                    <th scope="col">Website</th>
                    <th scope="col">Industry</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Owner</th>
                    <th scope="col" className="text-right">Findings</th>
                    <th scope="col" className="text-right">Confidence</th>
                    <th scope="col" className="text-right">
                      <Link href={buildHref({ sort: 'score', page: 1 })} className="hover:text-navy">Score</Link>
                    </th>
                    <th scope="col">
                      <Link href={buildHref({ sort: 'activity', page: 1 })} className="hover:text-navy">Last activity</Link>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.map((org) => (
                    <tr key={org.id}>
                      <td>
                        <Link href={`/leads/${org.id}`} className="font-semibold text-navy hover:text-blue hover:underline">
                          {org.brandName ?? org.legalName}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {org.isDemoData && <Badge tone="gold" title="Seeded demonstration record">demo data</Badge>}
                          {org._count.contacts === 0 && <Badge tone="muted">no contacts</Badge>}
                        </div>
                      </td>
                      <td className="max-w-[220px]">
                        {org.website ? (
                          <a
                            href={org.website}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="block truncate text-blue hover:underline"
                          >
                            {org.domainKey ?? org.website}
                          </a>
                        ) : (
                          <span className="text-muted-soft">Not recorded</span>
                        )}
                      </td>
                      <td className="text-muted">{org.industry ?? '—'}</td>
                      <td><StageBadge stage={org.stage} /></td>
                      <td className="text-muted">{org.owner?.name ?? <span className="text-muted-soft">Unassigned</span>}</td>
                      <td className="text-right numeric">{org._count.findings}</td>
                      <td className="text-right numeric">
                        {org.confidenceScore ?? <span className="text-muted-soft">—</span>}
                      </td>
                      <td className="text-right"><ScorePill score={org.opportunityScore} /></td>
                      <td className="whitespace-nowrap text-[12px] text-muted" title={formatDate(org.updatedAt, true)}>
                        {relativeAge(org.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <nav aria-label="Pagination" className="flex items-center justify-between border-t border-line-soft px-4 py-2.5 text-xs">
                <span className="text-muted">
                  Page {page} of {pages} · {total} records
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link href={buildHref({ page: page - 1 })} className="font-semibold text-blue hover:underline">
                      Previous
                    </Link>
                  )}
                  {page < pages && (
                    <Link href={buildHref({ page: page + 1 })} className="font-semibold text-blue hover:underline">
                      Next
                    </Link>
                  )}
                </div>
              </nav>
            )}
          </>
        )}
      </Card>
    </>
  );
}
