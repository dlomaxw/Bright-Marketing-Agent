import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiHandler, body, notFound, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { emailKey, phoneKey } from '@/lib/normalize';
import { logActivity } from '@/server/activity';
import { recomputeScores } from '@/server/scoring/recompute';

const contactSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.string().max(120).optional(),
  email: z.string().email().or(z.literal('')).optional(),
  phone: z.string().max(40).optional(),
  whatsapp: z.string().max(40).optional(),
  isPrimary: z.boolean().optional(),
  sourceUrl: z.string().max(500).optional(),
  sourceNote: z.string().max(500).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id: organizationId } = await ctx.params;
  const user = await requirePermission('org.update');

  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (!org || org.deletedAt) throw notFound('Organization');

  const input = await body(req, contactSchema);

  const eKey = emailKey(input.email);
  const pKey = phoneKey(input.phone);

  if (input.isPrimary) {
    // Reset existing primary contacts if this one is primary
    await db.contact.updateMany({
      where: { organizationId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  const contact = await db.contact.create({
    data: {
      organizationId,
      name: input.name,
      role: input.role || null,
      email: input.email || null,
      emailKey: eKey,
      phone: input.phone || null,
      phoneKey: pKey,
      whatsapp: input.whatsapp || null,
      isPrimary: input.isPrimary ?? false,
      sourceUrl: input.sourceUrl || null,
      sourceNote: input.sourceNote || null,
      verificationStatus: 'unverified',
    },
  });

  await logActivity({
    organizationId,
    actorId: user.id,
    action: 'contact.created',
    entityType: 'contact',
    entityId: contact.id,
    newValue: { name: contact.name, email: contact.email },
  });

  await recomputeScores(organizationId);

  return ok({ contact });
});
