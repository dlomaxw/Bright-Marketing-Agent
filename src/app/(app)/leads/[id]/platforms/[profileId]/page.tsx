import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePageUser } from '@/server/auth/guard';
import { can } from '@/server/auth/permissions';
import { parseJson } from '@/lib/json';
import { z } from 'zod';
import { checklistFor } from '@/audit/checks/social';
import { PLATFORM_LABELS, type Platform } from '@/lib/enums';
import { Notice, PageHeader } from '@/components/ui';
import { ChecklistForm } from './form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  const profile = await db.platformProfile.findUnique({
    where: { id: profileId },
    select: { platform: true },
  });
  const label = profile ? (PLATFORM_LABELS[profile.platform as Platform] ?? profile.platform) : 'Platform';
  return { title: `${label} review` };
}

export default async function PlatformReviewPage({
  params,
}: {
  params: Promise<{ id: string; profileId: string }>;
}) {
  const { id, profileId } = await params;
  const user = await requirePageUser();

  const profile = await db.platformProfile.findUnique({
    where: { id: profileId },
    include: {
      organization: { select: { id: true, legalName: true, brandName: true, deletedAt: true } },
    },
  });

  if (!profile || profile.organizationId !== id || profile.organization.deletedAt) notFound();

  const platform = profile.platform as Platform;
  const items = checklistFor(platform);
  const saved = parseJson(profile.checklistJson, z.record(z.string(), z.string()), {});
  const displayName = profile.organization.brandName ?? profile.organization.legalName;
  const editable = can(user.role, 'org.update');

  const reviewer = profile.checkedBy
    ? await db.user.findUnique({ where: { id: profile.checkedBy }, select: { name: true } })
    : null;

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link href="/leads" className="hover:underline">Leads</Link>
            {' · '}
            <Link href={`/leads/${profile.organization.id}`} className="hover:underline">{displayName}</Link>
          </>
        }
        title={`${PLATFORM_LABELS[platform] ?? platform} review`}
        description={
          profile.lastCheckedAt
            ? `Last completed ${profile.lastCheckedAt.toISOString().slice(0, 10)}${reviewer ? ` by ${reviewer.name}` : ''}.`
            : 'Not yet reviewed.'
        }
      />

      <div className="mb-4 max-w-3xl">
        <Notice tone="info" title="Answer only what you can see">
          Leave an item as <strong>Not checked</strong> if you did not confirm it yourself. &ldquo;Not
          checked&rdquo; and &ldquo;checked and missing&rdquo; produce different recommendations, so
          they are never treated as the same answer. Follower counts are not recorded here — they are
          only ever read from an authorised platform API.
        </Notice>
      </div>

      <div className="max-w-3xl">
        <ChecklistForm
          organizationId={profile.organization.id}
          profileId={profile.id}
          profileUrl={profile.url}
          items={items}
          saved={saved}
          notes={profile.notes ?? ''}
          editable={editable}
        />
      </div>
    </>
  );
}
