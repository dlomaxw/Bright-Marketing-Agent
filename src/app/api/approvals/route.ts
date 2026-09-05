import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, body, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { decideApproval, submitForApproval, type ApprovableType } from '@/server/approvals';

const schema = z.object({
  entityType: z.enum(['report', 'proposal', 'email']),
  entityId: z.string().min(1),
  action: z.enum(['submit', 'approve', 'reject']),
  comment: z.string().max(2000).optional(),
});

export const POST = apiHandler(async (req: NextRequest) => {
  const input = await body(req, schema);
  const type = input.entityType as ApprovableType;

  if (input.action === 'submit') {
    const user = await requirePermission(`${type}.submit` as const);
    await submitForApproval(type, input.entityId, user, input.comment);
    return ok({ status: 'submitted' });
  }

  const permission = (input.action === 'approve' ? `${type}.approve` : `${type}.reject`) as
    | 'report.approve' | 'report.reject'
    | 'proposal.approve' | 'proposal.reject'
    | 'email.approve' | 'email.reject';
  const user = await requirePermission(permission);
  await decideApproval(
    type,
    input.entityId,
    user,
    input.action === 'approve' ? 'approved' : 'rejected',
    input.comment,
  );
  return ok({ status: input.action === 'approve' ? 'approved' : 'rejected' });
});
