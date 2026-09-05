import 'dotenv/config';
import { env, integrations } from '../src/lib/env';
import { smtpConfigProblems, verifySmtpConnection, SPACEMAIL_DEFAULTS } from '../src/server/emails/smtp';
import { checkSendingDomain, fetchSpaceshipDnsRecords } from '../src/server/emails/dns-readiness';

/**
 * Checks whether outreach could actually be delivered, without sending anything.
 *
 *   npx tsx scripts/email-readiness.ts
 *   npx tsx scripts/email-readiness.ts --domain brightilluminated.com --selector spacemail
 *   npx tsx scripts/email-readiness.ts --test-connection
 *
 * `--test-connection` opens an authenticated SMTP session and disconnects. That
 * is the furthest anything can be verified without emailing a real person.
 */

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const tick = (s: 'pass' | 'warn' | 'fail' | 'unknown') =>
  s === 'pass' ? 'PASS' : s === 'warn' ? 'WARN' : s === 'fail' ? 'FAIL' : ' ?  ';

async function main() {
  const domain =
    opt('domain') ?? env.EMAIL_FROM_ADDRESS.split('@')[1] ?? env.SMTP_USER?.split('@')[1] ?? null;

  console.log('\nBrightScope — outreach delivery readiness');
  console.log('='.repeat(60));

  // --- Mode -----------------------------------------------------------------
  console.log(`\nProvider: ${env.EMAIL_PROVIDER}`);
  if (env.EMAIL_PROVIDER === 'console') {
    console.log(
      '  SAFE MODE. Approved emails are recorded in the outbox and activity log,\n' +
        '  and nothing is transmitted. Set EMAIL_PROVIDER=smtp to send for real.',
    );
  } else {
    console.log('  LIVE. Approved emails will be delivered to real recipients.');
  }

  // --- SMTP configuration ---------------------------------------------------
  console.log('\nSMTP configuration');
  console.log('-'.repeat(60));
  const problems = smtpConfigProblems();
  if (problems.length === 0) {
    console.log(`  PASS  ${env.SMTP_HOST}:${env.SMTP_PORT} as ${env.SMTP_USER}`);
    console.log(`        From: ${env.EMAIL_FROM_ADDRESS}`);
  } else {
    for (const p of problems) console.log(`  FAIL  ${p.field}: ${p.message}`);
    console.log(
      `\n  For Spacemail use host ${SPACEMAIL_DEFAULTS.host}, port ` +
        `${SPACEMAIL_DEFAULTS.implicitTlsPort} (SSL) or ${SPACEMAIL_DEFAULTS.starttlsPort} (STARTTLS),\n` +
        '  and authenticate with the full mailbox address and its password.',
    );
  }

  // --- Connection -----------------------------------------------------------
  if (flag('test-connection')) {
    console.log('\nSMTP connection (authenticates, sends nothing)');
    console.log('-'.repeat(60));
    const result = await verifySmtpConnection();
    console.log(result.ok ? '  PASS  Authenticated successfully.' : `  FAIL  ${result.error}`);
  } else {
    console.log('\n  (pass --test-connection to authenticate against the server)');
  }

  // --- Sending domain DNS ---------------------------------------------------
  if (!domain) {
    console.log('\nNo sending domain to check. Set EMAIL_FROM_ADDRESS or pass --domain.');
  } else {
    console.log(`\nSending domain: ${domain}`);
    console.log('-'.repeat(60));
    const readiness = await checkSendingDomain(domain, opt('selector') ?? 'spacemail');
    for (const check of readiness.checks) {
      console.log(`  ${tick(check.status)}  ${check.label.padEnd(16)} ${check.detail}`);
      if (check.record) console.log(`        ${check.record}`);
    }
    console.log(`\n  ${readiness.summary}`);

    // --- Spaceship ----------------------------------------------------------
    console.log('\nSpaceship DNS (what the zone is configured to publish)');
    console.log('-'.repeat(60));
    if (!integrations.spaceship) {
      console.log('  Not configured.');
      console.log('  The Spaceship API needs BOTH a key and a secret:');
      console.log('    SPACESHIP_API_KEY=...');
      console.log('    SPACESHIP_API_SECRET=...');
      console.log('  It authenticates with X-Api-Key and X-Api-Secret headers.');
      console.log('  Note: this API manages domains and DNS. It cannot send email.');
    } else {
      const result = await fetchSpaceshipDnsRecords(domain);
      console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.message}`);
      for (const r of result.records.filter(
        (x) => x.type === 'MX' || x.type === 'TXT' || x.name.includes('_domainkey') || x.name.includes('_dmarc'),
      )) {
        console.log(`        ${r.type.padEnd(5)} ${r.name.padEnd(28)} ${r.value.slice(0, 60)}`);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(
    'Delivery readiness is only one prerequisite. Before real outreach also\n' +
      'complete the legal review and confirm the brand details — see\n' +
      'docs/DEPLOYMENT.md section 1.\n',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
