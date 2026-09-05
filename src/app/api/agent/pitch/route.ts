import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, badRequest, body, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { agentPitchCandidates } from '@/server/agent/memory';
import { createEmailDraft } from '@/server/emails/draft';
import { logActivity } from '@/server/activity';

const schema = z.object({
  /** Omit to let the agent choose the best ready candidate itself. */
  organizationId: z.string().optional(),
});

/**
 * "Pitch this client."
 *
 * The agent picks the best prospect it can actually act on, then drafts the
 * approach using the existing drafting pipeline — which references only
 * verified, fresh, client-facing findings and an approved sender signature.
 *
 * It stops at a draft. Everything downstream (approval, the eleven send gates,
 * a second person's sign-off) is unchanged, because an assistant that could
 * send would be an assistant that could send something wrong to a real business.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requirePermission('email.draft');
  const input = await body(req, schema);

  const candidates = await agentPitchCandidates(25);

  const chosen = input.organizationId
    ? candidates.find((c) => c.organizationId === input.organizationId)
    : candidates.find((c) => c.readyToPitch);

  if (!chosen) {
    if (input.organizationId) {
      throw badRequest(
        'That organization is not currently a viable pitch. Check its findings and contacts.',
      );
    }
    const blocked = candidates.slice(0, 5).map((c) => ({
      name: c.name,
      organizationId: c.organizationId,
      blockers: c.blockers,
    }));
    return ok({
      drafted: false,
      reason:
        'No prospect is ready to approach. Each of the highest-scoring ones is blocked by something that would fail the send checks anyway.',
      blocked,
    });
  }

  if (!chosen.readyToPitch) {
    return ok({
      drafted: false,
      organizationId: chosen.organizationId,
      name: chosen.name,
      reason: 'This prospect cannot be contacted yet.',
      blockers: chosen.blockers,
    });
  }

  const draft = await createEmailDraft({
    organizationId: chosen.organizationId,
    contactId: chosen.contact?.id ?? null,
    // At most two observations; the drafting service enforces the cap again and
    // re-checks that each one is still verified, client-facing and fresh.
    findingIds: chosen.usableFindings.slice(0, 2).map((f) => f.id),
    user,
  });

  await logActivity({
    organizationId: chosen.organizationId,
    actorId: user.id,
    action: 'agent.pitch_drafted',
    entityType: 'email_draft',
    entityId: draft.id,
    newValue: {
      opportunityScore: chosen.opportunityScore,
      findings: chosen.usableFindings.map((f) => f.reference),
    },
    reason: 'Assistant drafted an approach. It still requires human approval before sending.',
  });

  return ok({
    drafted: true,
    emailDraftId: draft.id,
    organizationId: chosen.organizationId,
    name: chosen.name,
    opportunityScore: chosen.opportunityScore,
    rationale: chosen.rationale,
    referencedFindings: chosen.usableFindings,
    warnings: draft.warnings,
    nextStep:
      'Review the draft, then submit it for approval. It cannot be sent until a second person approves it and every send check passes.',
    href: `/emails/${draft.id}`,
  });
});
