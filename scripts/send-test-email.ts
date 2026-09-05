import 'dotenv/config';
import { deliverBySmtp, smtpConfigProblems } from '../src/server/emails/smtp';

/**
 * Sends one deliverability test message to an address given on the command
 * line. This is a diagnostic, not outreach: it bypasses no gate because it
 * touches no prospect, no draft and no organization. Real outreach goes through
 * src/server/emails/send.ts and its eleven gates.
 *
 *   npx tsx scripts/send-test-email.ts you@example.com
 */

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error('Usage: npx tsx scripts/send-test-email.ts <recipient>');
    process.exit(1);
  }

  const problems = smtpConfigProblems();
  if (problems.length > 0) {
    console.error('SMTP is not configured:');
    for (const p of problems) console.error(`  ${p.field}: ${p.message}`);
    process.exit(1);
  }

  const sentAt = new Date().toISOString();
  const messageId = await deliverBySmtp({
    to,
    toName: to,
    from: process.env.EMAIL_FROM_ADDRESS!,
    fromName: process.env.EMAIL_FROM_NAME ?? 'Bright Thoughts Services',
    replyTo: null,
    subject: `BrightScope delivery test — ${sentAt.slice(0, 19)}Z`,
    body: [
      'This is an automated delivery test from BrightScope.',
      '',
      `Sent: ${sentAt}`,
      `Sender: ${process.env.EMAIL_FROM_ADDRESS}`,
      `Server: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`,
      '',
      'If you are reading this, SMTP authentication and delivery both work.',
      'Check whether it arrived in the inbox or the spam folder, and open',
      '"Show original" in Gmail to see the SPF, DKIM and DMARC results.',
      '',
      'No prospect was contacted. This message was not generated from a lead',
      'record and did not pass through the outreach approval gates.',
    ].join('\n'),
  });

  console.log(`Accepted by the server. Message id: ${messageId}`);
}

main().catch((err) => {
  console.error('Send failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
