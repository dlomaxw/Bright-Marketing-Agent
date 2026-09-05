import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { Card, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Services & Pricing Catalogue' };

export default async function ServicesPage() {
  await requirePageUser();

  const services = await db.serviceModule.findMany({
    where: { active: true },
    include: {
      prices: true,
    },
    orderBy: { sortOrder: 'asc' },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Services & Pricing Catalogue"
        description="Core service modules and default fee structures linked to deterministic finding triggers."
      />

      {services.length === 0 ? (
        <EmptyState
          title="No service modules configured"
          description="Service modules are loaded via system seed data or administrator setup."
        />
      ) : (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-canvas text-[11px] font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2.5">Code / Name</th>
                  <th className="px-4 py-2.5">Family</th>
                  <th className="px-4 py-2.5">Default Phase</th>
                  <th className="px-4 py-2.5">Deliverables Summary</th>
                  <th className="px-4 py-2.5">Configured Prices</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {services.map((svc) => {
                  const deliverables: string[] = svc.deliverablesJson
                    ? JSON.parse(svc.deliverablesJson)
                    : [];
                  return (
                    <tr key={svc.id} className="hover:bg-canvas/50">
                      <td className="px-4 py-3 font-semibold text-navy">
                        <div>{svc.name}</div>
                        <span className="font-mono text-[10px] text-muted">{svc.code}</span>
                      </td>
                      <td className="px-4 py-3 text-muted capitalize">{svc.family}</td>
                      <td className="px-4 py-3 text-muted font-mono text-[11px]">
                        {svc.defaultPhase}
                      </td>
                      <td className="px-4 py-3 text-muted max-w-xs">
                        <p className="line-clamp-2">{svc.summary}</p>
                        {deliverables.length > 0 && (
                          <span className="mt-0.5 block text-[10px] text-muted-soft">
                            {deliverables.length} itemized deliverables
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-navy">
                        {svc.prices.length === 0 ? (
                          <span className="text-high font-semibold">Unpriced (Admin setup needed)</span>
                        ) : (
                          svc.prices.map((p) => (
                            <div key={p.id} className="text-[11px]">
                              {p.currency} {p.amount.toLocaleString()} / {p.unit}
                            </div>
                          ))
                        )}
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
