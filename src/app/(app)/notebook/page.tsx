import { requirePageUser } from '@/server/auth/guard';
import { db } from '@/lib/db';
import { NotebookWorkbench } from '@/components/notebook-workbench';

export default async function NotebookPage() {
  await requirePageUser('org.read');

  const orgs = await db.organization.findMany({
    take: 50,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      legalName: true,
      industry: true,
      _count: {
        select: { findings: { where: { verificationStatus: 'manually_verified' } } },
      },
    },
  });

  const formattedOrgs = orgs.map((o) => ({
    id: o.id,
    name: o.legalName,
    industry: o.industry,
    findingsCount: o._count.findings,
  }));

  return <NotebookWorkbench organizations={formattedOrgs} />;
}
