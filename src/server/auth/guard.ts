import 'server-only';
import { redirect } from 'next/navigation';
import { getSessionUser, type SessionUser } from './session';
import { can, type Action } from './permissions';
import type { Role } from '@/lib/enums';
import { logActivity } from '@/server/activity';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
    readonly action?: Action,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** For API route handlers. Throws AuthError, which `apiHandler` turns into 401/403. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError('Sign in required.', 401);
  return user;
}

/**
 * The authorization gate. Every mutation path calls this.
 * Denials are recorded so permission incidents show up in operations metrics.
 */
export async function requirePermission(action: Action): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, action)) {
    await logActivity({
      actorId: user.id,
      action: 'permission.denied',
      entityType: 'permission',
      entityId: action,
      reason: `Role "${user.role}" attempted "${action}"`,
    }).catch(() => undefined);
    throw new AuthError(`Your role does not allow this action (${action}).`, 403, action);
  }
  return user;
}

/** For server components. Redirects rather than throwing. */
export async function requirePageUser(returnTo?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login');
  }
  return user;
}

export async function requirePagePermission(action: Action): Promise<SessionUser> {
  const user = await requirePageUser();
  if (!can(user.role, action)) redirect('/forbidden');
  return user;
}

/**
 * Separation of duties: nobody approves their own work, whatever their role.
 * Enforced server-side so a UI change can never weaken it.
 */
/**
 * Returns true when the approver is also the submitter.
 *
 * Kept separate from the throwing check so a caller can record that a
 * self-approval happened. It is permitted for some roles, but it is never
 * invisible.
 */
export function isSelfApproval(
  approverId: string,
  submitterId: string | null | undefined,
): boolean {
  return Boolean(submitterId) && approverId === submitterId;
}

export function assertNotSelfApproval(
  approverId: string,
  submitterId: string | null | undefined,
  role?: Role,
): void {
  if (!isSelfApproval(approverId, submitterId)) return;
  // Administrators may approve their own submission; everyone else may not.
  if (role && can(role, 'approval.self_approve')) return;

  throw new AuthError(
    'You submitted this item, so you cannot approve it. A second person must review it.',
    403,
  );
}
