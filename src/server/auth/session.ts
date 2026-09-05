import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { db } from '@/lib/db';
import { env, isProd } from '@/lib/env';
import type { Role } from '@/lib/enums';

export const SESSION_COOKIE = 'bs_session';

const secret = new TextEncoder().encode(env.SESSION_SECRET);

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  seniorApprover: boolean;
  signature: string | null;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Sessions are double-anchored: a signed JWT in an httpOnly cookie *and* a
 * Session row. The row makes revocation real - deleting a user or ending a
 * session takes effect on the next request rather than at token expiry.
 */
export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<string> {
  const sessionId = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000);

  await db.session.create({
    data: {
      userId,
      tokenHash: sha256(sessionId),
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip ?? null,
      expiresAt,
    },
  });

  const token = await new SignJWT({ sid: sessionId, uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    expires: expiresAt,
  });

  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return sessionId;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret);
      const sid = payload.sid;
      if (typeof sid === 'string') {
        await db.session.updateMany({
          where: { tokenHash: sha256(sid), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    } catch {
      // Invalid token: nothing to revoke, still clear the cookie.
    }
  }
  jar.delete(SESSION_COOKIE);
}

/** Resolve the current user, or null. Never throws. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let sid: string;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sid !== 'string') return null;
    sid = payload.sid;
  } catch {
    return null;
  }

  const session = await db.session.findUnique({
    where: { tokenHash: sha256(sid) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  const u = session.user;
  if (!u || u.status !== 'active' || u.deletedAt) return null;

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.roleCode as Role,
    seniorApprover: u.seniorApprover,
    signature: u.signature,
  };
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await db.session.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
  });
  return count;
}
