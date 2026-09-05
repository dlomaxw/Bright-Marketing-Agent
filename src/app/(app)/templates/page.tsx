import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { Card, EmptyState, PageHeader, formatDate } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Templates' };

export default async function TemplatesPage() {
  await requirePageUser();

  const templates = await db.template.findMany({
    where: { active: true, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document & Email Templates"
        description="Pre-approved templates for audit report boilerplate, proposal narratives, and deterministic outreach copy."
      />

      {templates.length === 0 ? (
        <EmptyState
          title="No active templates"
          description="Templates are managed by system administrators to maintain brand tone and legal compliance."
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-canvas text-[11px] font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">Name / Key</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Version</th>
                  <th className="px-4 py-2.5">Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {templates.map((tpl) => (
                  <tr key={tpl.id} className="hover:bg-canvas/50">
                    <td className="px-4 py-3 font-semibold text-navy">
                      <div>{tpl.name}</div>
                      <span className="font-mono text-[10px] text-muted">{tpl.key}</span>
                    </td>
                    <td className="px-4 py-3 text-muted uppercase text-[10px] font-semibold">
                      {tpl.type}
                    </td>
                    <td className="px-4 py-3 text-muted font-mono">v{tpl.version}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(tpl.updatedAt)}</td>
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
