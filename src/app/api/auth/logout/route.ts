import { apiHandler, ok } from '@/lib/api';
import { destroySession, getSessionUser } from '@/server/auth/session';
import { logActivity } from '@/server/activity';

export const POST = apiHandler(async () => {
  const user = await getSessionUser();
  await destroySession();
  if (user) {
    await logActivity({
      actorId: user.id,
      action: 'auth.logout',
      entityType: 'user',
      entityId: user.id,
    });
  }
  return ok({ ok: true });
});
