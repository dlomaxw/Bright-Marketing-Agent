import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt from the Node standard library. Chosen over bcrypt/argon2 so the
 * project has no native build step - relevant on Windows developer machines and
 * in slim container images.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(saltB64 ?? '', 'base64');
  const expected = Buffer.from(keyB64 ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: PARAMS.maxmem,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Minimum policy for a first-party console. Enforced on create and on change. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push('Must be at least 12 characters.');
  if (!/[a-z]/.test(password)) problems.push('Must contain a lowercase letter.');
  if (!/[A-Z]/.test(password)) problems.push('Must contain an uppercase letter.');
  if (!/[0-9]/.test(password)) problems.push('Must contain a digit.');
  if (/^(password|brightscope|welcome|letmein)/i.test(password)) {
    problems.push('Must not start with a common word.');
  }
  return problems;
}
