import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiHandler, badRequest, body, notFound, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { changedFields, logActivity } from '@/server/activity';
import { recomputeScores } from '@/server/scoring/recompute';
import { zConfidence, zSeverity, zVerificationStatus } from '@/lib/enums';

const schema = z.object({
  action: z.enum(['accept', 'dismiss', 'needs_review', 'edit', 'set_visibility']),
  severity: zSeverity.optional(),
  confidence: zConfidence.optional(),
  observationText: z.string().min(3).max(2000).optional(),
  businessImpact: z.string().max(2000).optional(),
  recommendation: z.string().max(2000).optional(),
  analystNote: z.string().max(2000).optional(),
  clientVisible: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const input = await body(req, schema);

  const permission =
    input.action === 'dismiss'
      ? 'finding.dismiss'
      : input.action === 'set_visibility'
        ? 'finding.set_visibility'
        : input.action === 'edit'
          ? 'finding.edit'
          : 'finding.verify';
  const user = await requirePermission(permission);

  const finding = await db.finding.findUnique({ where: { id } });
  if (!finding || finding.deletedAt) throw notFound('Finding');

  const data: Record<string, unknown> = { reviewerId: user.id, reviewedAt: new Date() };

  switch (input.action) {
    case 'accept':
      data.verificationStatus = 'manually_verified';
      break;
    case 'dismiss':
      if (!input.reason?.trim()) {
        throw badRequest('A reason is required when dismissing a finding, so the decision is auditable.');
      }
      data.verificationStatus = 'dismissed';
      data.dismissReason = input.reason;
      data.clientVisible = false;
      break;
    case 'needs_review':
      data.verificationStatus = 'needs_review';
      break;
    case 'set_visibility': {
      if (input.clientVisible && finding.verificationStatus !== 'manually_verified') {
        throw badRequest(
          'Only a manually verified finding can be marked client-facing. Verify it first.',
        );
      }
      if (input.clientVisible && finding.requiresReverification) {
        throw badRequest(
          'This finding was imported and still requires re-verification. Run an audit to confirm it before using it with a client.',
        );
      }
      data.clientVisible = input.clientVisible ?? false;
      break;
    }
    case 'edit':
      if (input.severity) data.severity = input.severity;
      if (input.confidence) data.confidence = input.confidence;
      if (input.observationText) data.observation_text = input.observationText;
      if (input.businessImpact) data.businessImpact = input.businessImpact;
      if (input.recommendation) data.recommendation = input.recommendation;
      if (input.analystNote !== undefined) data.analystNote = input.analystNote;
      break;
  }

  const diff = changedFields(finding as unknown as Record<string, unknown>, data);
  await db.finding.update({ where: { id }, data });

  await logActivity({
    organizationId: finding.organizationId,
    actorId: user.id,
    action: `finding.${input.action}`,
    entityType: 'finding',
    entityId: id,
    previousValue: diff?.previous,
    newValue: diff?.next,
    reason: input.reason ?? null,
  });

  await recomputeScores(finding.organizationId);
  return ok({ id, status: data.verificationStatus ?? finding.verificationStatus });
});

const bulkSchema = z.object({ status: zVerificationStatus }).partial();
export const GET = apiHandler<Ctx>(async (_req, ctx) => {
  await requirePermission('finding.read');
  const { id } = await ctx.params;
  const finding = await db.finding.findUnique({
    where: { id },
    include: { evidence: true, observation: { include: { evidence: true } } },
  });
  if (!finding) throw notFound('Finding');
  bulkSchema.parse({});
  return ok(finding);
});
