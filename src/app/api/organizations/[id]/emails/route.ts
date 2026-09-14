import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiHandler, body, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { createEmailDraft } from '@/server/emails/draft';

const schema = z.object({
  contactId: z.string().nullable().optional(),
  findingIds: z.array(z.string()).max(2).optional(),
  reportId: z.string().nullable().optional(),
  proposalId: z.string().nullable().optional(),
  /**
   * Return the draft already in flight rather than creating another.
   *
   * Without this, each press of "Prepare outreach email" made a new record.
   * Four accumulated for one organization, two of them separately approved,
   * and approving one left the rest untouched — indistinguishable, from the
   * screen, from an approval that would not stick.
   */
  reuseExisting: z.boolean().default(false),
});

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('email.draft');
  const input = await body(req, schema);

  if (input.reuseExisting) {
    const existing = await db.emailDraft.findFirst({
      where: {
        organizationId: id,
        deletedAt: null,
        // Anything not yet gone to the client is still the live draft.
        status: { notIn: ['sent', 'delivered', 'replied', 'bounced', 'cancelled'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
    if (existing) {
      return ok(
        {
          id: existing.id,
          reused: true,
          warnings: [
            `An outreach email for this organization already exists and is ${existing.status.replace(/_/g, ' ')}. Opening that one rather than starting another.`,
          ],
        },
        200,
      );
    }
  }

  const result = await createEmailDraft({
    organizationId: id,
    contactId: input.contactId ?? null,
    findingIds: input.findingIds,
    reportId: input.reportId ?? null,
    proposalId: input.proposalId ?? null,
    user,
  });
  return ok(result, 201);
});
