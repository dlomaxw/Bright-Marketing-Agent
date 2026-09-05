import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { Card, EmptyState, PageHeader, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Activity Log' };

export default async function ActivityLogsPage() {
  await requirePageUser();

  const logs = await db.activity.findMany({
    orderBy: { occurredAt: 'desc' },
    include: {
      actor: { select: { name: true, role: true } },
      organization: { select: { legalName: true } },
    },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity & Audit Log"
        description="Append-only historical compliance log tracking all system mutations, lead imports, approvals, and report actions."
      />

      {logs.length === 0 ? (
        <EmptyState
          title="No activity recorded"
          description="System operations, imports, and governance events write append-only records here."
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-canvas text-[11px] font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">Timestamp</th>
                  <th className="px-4 py-2.5">Actor</th>
                  <th className="px-4 py-2.5">Action</th>
                  <th className="px-4 py-2.5">Entity / Target</th>
                  <th className="px-4 py-2.5">Organization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-canvas/50">
                    <td className="px-4 py-3 font-mono text-[11px] text-muted">
                      {formatDate(log.occurredAt)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-navy">
                      {log.actor?.name || 'System'}
                      {log.actor?.role?.name && (
                        <span className="block text-[10px] font-normal text-muted uppercase">
                          {log.actor.role.name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-blue font-semibold">
                      {log.action}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      <span className="capitalize">{log.entityType}</span>
                      {log.entityId && (
                        <span className="font-mono text-[10px] text-muted-soft block truncate max-w-[140px]">
                          {log.entityId}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-navy">
                      {log.organization?.legalName || '—'}
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
