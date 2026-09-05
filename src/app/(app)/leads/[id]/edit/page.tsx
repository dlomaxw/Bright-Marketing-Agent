import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { Card, PageHeader } from '@/components/ui';
import { LeadEditForm } from './form';

export const dynamic = 'force-dynamic';

export default async function EditLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageUser();
  const { id } = await params;

  const org = await db.organization.findUnique({
    where: { id },
  });

  if (!org || org.deletedAt) {
    notFound();
  }

  const tags: string[] = org.tagsJson ? JSON.parse(org.tagsJson) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={`Edit ${org.legalName}`}
        description="Update organization details, pipeline stage, and notes."
        actions={
          <Link href={`/leads/${org.id}`} className="text-xs font-semibold text-blue hover:underline">
            ← Back to Workspace
          </Link>
        }
      />

      <Card title="Organization Details">
        <LeadEditForm org={org} tags={tags} />
      </Card>
    </div>
  );
}
