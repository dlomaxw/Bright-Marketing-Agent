import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The SMTP configuration checks.
 *
 * A misconfiguration here does not throw an obvious error — it delivers mail
 * that quietly lands in spam folders. These tests pin the checks that catch the
 * two most damaging cases: an incomplete configuration, and a From address on a
 * different domain to the authenticated mailbox.
 */

async function withEnv(overrides: Record<string, string>) {
  vi.resetModules();
  const previous = { ...process.env };
  Object.assign(process.env, {
    DATABASE_URL: 'file:./prisma/test.db',
    SESSION_SECRET: 'test-only-secret-not-used-for-anything-real-0123456789',
    ...overrides,
  });
  const mod = await import('../src/server/emails/smtp');
  return {
    mod,
    restore: () => {
      process.env = previous;
    },
  };
}

const FULL = {
  SMTP_HOST: 'mail.spacemail.com',
  SMTP_PORT: '465',
  SMTP_USER: 'hello@brightilluminated.com',
  SMTP_PASSWORD: 'secret',
  EMAIL_FROM_ADDRESS: 'hello@brightilluminated.com',
};

afterEach(() => {
  vi.resetModules();
});

describe('smtp configuration', () => {
  it('accepts a complete Spacemail configuration', async () => {
    const { mod, restore } = await withEnv(FULL);
    expect(mod.smtpConfigProblems()).toEqual([]);
    restore();
  });

  it('reports every missing field rather than only the first', async () => {
    const { mod, restore } = await withEnv({
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      EMAIL_FROM_ADDRESS: '',
    });
    const fields = mod.smtpConfigProblems().map((p) => p.field);
    expect(fields).toContain('SMTP_HOST');
    expect(fields).toContain('SMTP_USER');
    expect(fields).toContain('SMTP_PASSWORD');
    expect(fields).toContain('EMAIL_FROM_ADDRESS');
    restore();
  });

  it('requires the full mailbox address as the username', async () => {
    const { mod, restore } = await withEnv({ ...FULL, SMTP_USER: 'hello' });
    const problem = mod.smtpConfigProblems().find((p) => p.field === 'SMTP_USER');
    expect(problem?.message).toMatch(/full mailbox address/i);
    restore();
  });

  it('catches a From address on a different domain to the mailbox', async () => {
    // The most common cause of silent spam-foldering.
    const { mod, restore } = await withEnv({
      ...FULL,
      SMTP_USER: 'hello@brightilluminated.com',
      EMAIL_FROM_ADDRESS: 'sales@some-other-domain.com',
    });
    const problem = mod.smtpConfigProblems().find((p) => p.field === 'EMAIL_FROM_ADDRESS');
    expect(problem?.message).toMatch(/differs from the authenticated mailbox/i);
    restore();
  });

  it('flags an unusual submission port', async () => {
    const { mod, restore } = await withEnv({ ...FULL, SMTP_PORT: '8025' });
    const problem = mod.smtpConfigProblems().find((p) => p.field === 'SMTP_PORT');
    expect(problem?.message).toMatch(/unusual/i);
    restore();
  });

  it('publishes the Spacemail defaults so the UI can suggest them', async () => {
    const { mod, restore } = await withEnv(FULL);
    expect(mod.SPACEMAIL_DEFAULTS.host).toBe('mail.spacemail.com');
    expect(mod.SPACEMAIL_DEFAULTS.implicitTlsPort).toBe(465);
    expect(mod.SPACEMAIL_DEFAULTS.starttlsPort).toBe(587);
    restore();
  });
});
