import { apiHandler, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { checkStorage } from '@/server/storage/r2';

/**
 * Reports whether object storage is actually reachable from wherever the
 * application is running.
 *
 * `npm run storage:check` answers that for the machine it runs on, which is not
 * the machine that serves requests. Reaching R2 from a laptop and reaching it
 * from the deployment are different questions, and only the second one decides
 * whether evidence can be stored.
 */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  await requirePermission('settings.write');
  return ok(await checkStorage());
});
