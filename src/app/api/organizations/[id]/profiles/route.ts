import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiHandler, body, notFound, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { logActivity } from '@/server/activity';
import { zPlatform } from '@/lib/enums';

const profileSchema = z.object({
  platform: zPlatform,
  url: z.string().url().max(500),
  handle: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id: organizationId } = await ctx.params;
  const user = await requirePermission('org.update');

  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (!org || org.deletedAt) throw notFound('Organization');

  const input = await body(req, profileSchema);

  const profile = await db.platformProfile.create({
    data: {
      organizationId,
      platform: input.platform,
      url: input.url,
      handle: input.handle || null,
      notes: input.notes || null,
      verificationStatus: 'unverified',
    },
  });

  await logActivity({
    organizationId,
    actorId: user.id,
    action: 'profile.created',
    entityType: 'platform_profile',
    entityId: profile.id,
    newValue: { platform: profile.platform, url: profile.url },
  });

  return ok({ profile });
});
