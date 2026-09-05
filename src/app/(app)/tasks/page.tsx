import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { Card, EmptyState, PageHeader, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Follow-ups and Tasks' };

export default async function TasksPage() {
  await requirePageUser();

  const tasks = await db.task.findMany({
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    include: {
      organization: { select: { id: true, legalName: true } },
      owner: { select: { name: true } },
    },
    take: 100,
  });

  const now = new Date();
  const overdueCount = tasks.filter(
    (t) => t.status === 'open' && t.dueAt && new Date(t.dueAt) < now
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-ups and Tasks"
        description="Manage prospect outreach reminders, scheduled re-verifications, and strategy follow-ups."
      />

      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks recorded"
          description="Tasks are created from lead workspaces to schedule follow-ups or manual reviews."
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-canvas text-[11px] font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">Task / Organization</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Assignee</th>
                  <th className="px-4 py-2.5">Due Date</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {tasks.map((task) => {
                  const isOverdue =
                    task.status === 'open' && task.dueAt && new Date(task.dueAt) < now;
                  return (
                    <tr key={task.id} className="hover:bg-canvas/50">
                      <td className="px-4 py-3 font-semibold text-navy">
                        <div>{task.title}</div>
                        {task.organization && (
                          <Link
                            href={`/leads/${task.organization.id}`}
                            className="text-[11px] font-normal text-blue hover:underline block"
                          >
                            {task.organization.legalName}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted uppercase text-[10px] font-semibold">
                        {task.type}
                      </td>
                      <td className="px-4 py-3 text-muted">{task.owner?.name || 'Unassigned'}</td>
                      <td className="px-4 py-3">
                        {task.dueAt ? (
                          <span
                            className={`font-medium ${
                              isOverdue ? 'text-critical font-semibold' : 'text-navy'
                            }`}
                          >
                            {formatDate(task.dueAt)} {isOverdue && '(Overdue)'}
                          </span>
                        ) : (
                          <span className="text-muted">No due date</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            task.status === 'done'
                              ? 'bg-good-bg text-good'
                              : isOverdue
                              ? 'bg-critical-bg text-critical'
                              : 'bg-high-bg text-high'
                          }`}
                        >
                          {task.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
