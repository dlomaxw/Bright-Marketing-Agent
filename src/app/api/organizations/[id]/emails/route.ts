import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiHandler, body, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { createEmailDraft } from '@/server/emails/draft';
import { resolveAttachmentLink } from '@/server/emails/attachments';

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
      select: { id: true, status: true, reportId: true, proposalId: true },
    });
    if (existing) {
      const warnings = [
        `An outreach email for this organization already exists and is ${existing.status.replace(/_/g, ' ')}. Opening that one rather than starting another.`,
      ];

      /**
       * Attach what the caller asked to send.
       *
       * Reuse was returning the existing draft and dropping the `proposalId`
       * that came with the request, because the link is only ever set when a
       * draft is created. Pressing "Prepare outreach email" from an approved
       * proposal therefore opened a draft that enclosed nothing, and the send
       * checklist called that "No attachments" and passed it. Four of the first
       * seven messages to real businesses went out empty that way.
       *
       * An approved draft is left alone: it is frozen, and quietly adding a
       * document to something an approver has already signed off would change
       * what they approved.
       */
      const frozen = ['approved', 'needs_review'].includes(existing.status);
      const wanted = {
        ...(input.reportId && !existing.reportId ? { reportId: input.reportId } : {}),
        ...(input.proposalId && !existing.proposalId ? { proposalId: input.proposalId } : {}),
      };

      if (Object.keys(wanted).length > 0) {
        if (frozen) {
          warnings.push(
            `It encloses no ${input.proposalId && !existing.proposalId ? 'proposal' : 'report'} and is already ${existing.status.replace(/_/g, ' ')}, so it cannot be changed. Cancel it and prepare a new one if the document should go with it.`,
          );
        } else {
          const link = await resolveAttachmentLink(id, wanted);
          await db.emailDraft.update({ where: { id: existing.id }, data: link.data });
          warnings.push(...link.notes);
        }
      }

      return ok({ id: existing.id, reused: true, warnings }, 200);
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
