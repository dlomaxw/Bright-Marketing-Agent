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
  const from = process.env.EMAIL_FROM_ADDRESS!;

  /**
   * Shaped like a real message rather than a machine test.
   *
   * A tiny plain body with a subject like "delivery test", no sender identity
   * and no way to unsubscribe is a spam signature in its own right — so a test
   * written that way tells you about the test, not about the sender. This
   * carries what a genuine outreach message carries, including the
   * List-Unsubscribe header the outreach path now sets.
   */
  const messageId = await deliverBySmtp({
    to,
    toName: to,
    from,
    fromName: process.env.EMAIL_FROM_NAME ?? 'Bright Thoughts Services',
    replyTo: null,
    subject: 'Checking our email setup',
    body: [
      'Hello,',
      '',
      'This is a short message to confirm our email is configured correctly.',
      'If it reached your inbox, sending is working as intended.',
      '',
      `Sent ${sentAt.slice(0, 19).replace('T', ' ')} UTC from ${process.env.SMTP_HOST}.`,
      '',
      'Kind regards,',
      'Bright Thoughts Services',
      '',
      '--',
      'Bright Thoughts Services · The Square Building, 3rd Street, Industrial Area, Kampala, Uganda',
      '+256 750 421 224 · +256 761 832 333',
      `Reply with "unsubscribe" to stop receiving messages from us.`,
    ].join('\n'),
  });

  console.log(`Accepted by the server. Message id: ${messageId}`);
}

main().catch((err) => {
  console.error('Send failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
