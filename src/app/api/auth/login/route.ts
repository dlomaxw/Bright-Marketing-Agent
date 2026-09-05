import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiHandler, body, clientIp, ok } from '@/lib/api';
import { verifyPassword } from '@/server/auth/password';
import { createSession } from '@/server/auth/session';
import { logActivity } from '@/server/activity';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

/**
 * Simple in-process throttle. Enough for a single-instance internal console;
 * behind multiple instances this moves to the shared store (docs/PHASE2.md).
 */
const attempts = new Map<string, { count: number; firstAt: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;

function throttled(key: string): boolean {
  const record = attempts.get(key);
  if (!record) return false;
  if (Date.now() - record.firstAt > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const record = attempts.get(key);
  if (!record || Date.now() - record.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  record.count += 1;
}

export const POST = apiHandler(async (req: NextRequest) => {
  const { email, password } = await body(req, schema);
  const ip = clientIp(req);
  const key = `${ip ?? 'unknown'}:${email.toLowerCase()}`;

  if (throttled(key)) {
    return NextResponse.json(
      { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' },
      { status: 429 },
    );
  }

  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });

  // The same response and roughly the same work for every failure mode, so the
  // endpoint does not reveal which accounts exist.
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !valid || user.status !== 'active' || user.deletedAt) {
    recordFailure(key);
    await logActivity({
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user?.id ?? null,
      reason: !user ? 'unknown_account' : !valid ? 'bad_password' : 'inactive_account',
      metadata: { email: email.toLowerCase() },
      ip,
    }).catch(() => undefined);

    return NextResponse.json({ error: 'Email address or password is incorrect.' }, { status: 401 });
  }

  attempts.delete(key);
  await createSession(user.id, { userAgent: req.headers.get('user-agent'), ip });
  await logActivity({
    actorId: user.id,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    ip,
  });

  return ok({ id: user.id, name: user.name, role: user.roleCode });
});
