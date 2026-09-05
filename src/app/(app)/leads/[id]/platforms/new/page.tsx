import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { PageHeader } from '@/components/ui';
import { PlatformForm } from './form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await db.organization.findUnique({ where: { id }, select: { legalName: true, brandName: true } });
  return { title: `Add Social/Web Profile — ${org ? (org.brandName ?? org.legalName) : 'Lead'}` };
}

export default async function NewPlatformPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageUser();

  const org = await db.organization.findUnique({
    where: { id },
    select: { id: true, legalName: true, brandName: true },
  });

  if (!org) notFound();

  const displayName = org.brandName ?? org.legalName;

  return (
    <>
      <PageHeader
        breadcrumb={<Link href={`/leads/${org.id}`} className="hover:underline">{displayName}</Link>}
        title="Add Social & Digital Platform Profile"
        description="Track Facebook, LinkedIn, Google Business, Instagram, or YouTube accounts for digital audit checks."
      />
      <div className="max-w-xl">
        <PlatformForm organizationId={org.id} />
      </div>
    </>
  );
}
