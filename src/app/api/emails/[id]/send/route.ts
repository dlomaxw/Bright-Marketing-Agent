import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, body, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { sendApprovedEmail } from '@/server/emails/send';

const schema = z.object({
  manual: z.boolean().default(false),
  note: z.string().max(500).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export const POST = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('email.send');
  const input = await body(req, schema);
  const result = await sendApprovedEmail(id, user, { manual: input.manual, manualNote: input.note });
  return ok(result);
});
