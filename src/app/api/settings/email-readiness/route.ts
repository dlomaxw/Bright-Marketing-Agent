import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiHandler, ok, query } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { env, integrations } from '@/lib/env';
import { smtpConfigProblems, verifySmtpConnection, SPACEMAIL_DEFAULTS } from '@/server/emails/smtp';
import { checkSendingDomain, fetchSpaceshipDnsRecords } from '@/server/emails/dns-readiness';

const schema = z.object({
  domain: z.string().max(200).optional(),
  dkimSelector: z.string().max(60).default('default'),
  /** Opens an authenticated SMTP connection. Sends nothing. */
  testConnection: z.coerce.boolean().default(false),
});

/**
 * Reports whether outreach could actually be delivered — configuration, SMTP
 * authentication and the sending domain's DNS.
 *
 * It never sends a message. `testConnection` opens a connection, authenticates
 * and disconnects, which is the furthest you can check without emailing someone.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  await requirePermission('settings.write');
  const params = query(req, schema);

  const domain =
    params.domain ??
    env.EMAIL_FROM_ADDRESS.split('@')[1] ??
    env.SMTP_USER?.split('@')[1] ??
    null;

  const configProblems = smtpConfigProblems();

  const connection = params.testConnection
    ? await verifySmtpConnection()
    : { ok: null as null, error: 'Not tested. Pass testConnection=true to authenticate.' };

  const dns = domain ? await checkSendingDomain(domain, params.dkimSelector) : null;
  const spaceship = domain ? await fetchSpaceshipDnsRecords(domain) : null;

  return ok({
    provider: env.EMAIL_PROVIDER,
    sendingEnabled: integrations.emailProvider,
    safeMode: env.EMAIL_PROVIDER === 'console',
    smtp: {
      host: env.SMTP_HOST ?? null,
      port: env.SMTP_PORT ?? null,
      user: env.SMTP_USER ? `${env.SMTP_USER.split('@')[0]?.slice(0, 2)}***@${env.SMTP_USER.split('@')[1]}` : null,
      from: env.EMAIL_FROM_ADDRESS || null,
      configured: configProblems.length === 0,
      problems: configProblems,
      connection,
      spacemailDefaults: SPACEMAIL_DEFAULTS,
    },
    dns,
    spaceship: spaceship
      ? {
          configured: spaceship.configured,
          ok: spaceship.ok,
          message: spaceship.message,
          recordCount: spaceship.records.length,
          // Only the records relevant to sending.
          mailRecords: spaceship.records.filter(
            (r) => r.type === 'MX' || r.type === 'TXT' || r.name.includes('_domainkey') || r.name.includes('_dmarc'),
          ),
        }
      : null,
    note:
      'The Spaceship API manages domains and DNS; it cannot send email. Sending goes over SMTP to Spacemail.',
  });
});
