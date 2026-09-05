import 'dotenv/config';
import tls from 'node:tls';
import { deliverBySmtp, smtpConfigProblems } from '../src/server/emails/smtp';

/**
 * Asks a receiving mail server what it actually thinks of our messages.
 *
 * `email:check` reads DNS — what we publish. This reads the verdict: it sends
 * one message to a public authentication verifier and reads the reply out of
 * the sending mailbox over IMAP. The difference matters. A DKIM record can be
 * published correctly while the mail server never signs anything, and DNS
 * alone cannot tell you which.
 *
 *   npm run email:auth
 *
 * It reads exactly one message — the verifier's reply, matched on sender — and
 * prints only the authentication lines.
 */

const VERIFIER = 'check-auth@verifier.port25.com';

function imapFetchVerifierReply(): Promise<string[]> {
  return new Promise((resolve) => {
    const host = process.env.IMAP_HOST || process.env.SMTP_HOST!;
    const port = Number(process.env.IMAP_PORT || 993);
    const user = process.env.SMTP_USER!;
    const pass = process.env.SMTP_PASSWORD!;

    const socket = tls.connect({ host, port, servername: host });
    const out: string[] = [];
    let buf = '';
    let step = 0;
    const send = (s: string) => socket.write(s + '\r\n');
    const finish = (lines: string[]) => {
      try { socket.end(); } catch { /* already closed */ }
      resolve(lines);
    };

    socket.setTimeout(30_000, () => finish(['IMAP timed out.']));

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');

      if (step === 0 && buf.includes('* OK')) {
        step = 1; buf = ''; send(`a1 LOGIN "${user}" "${pass}"`); return;
      }
      if (step === 1 && /a1 (OK|NO|BAD)/.test(buf)) {
        if (!/a1 OK/.test(buf)) return finish([`IMAP login failed: ${buf.trim().slice(0, 160)}`]);
        step = 2; buf = ''; send('a2 SELECT INBOX'); return;
      }
      if (step === 2 && /a2 (OK|NO|BAD)/.test(buf)) {
        step = 3; buf = ''; send('a3 SEARCH FROM "port25"'); return;
      }
      if (step === 3 && /a3 (OK|NO|BAD)/.test(buf)) {
        const ids = (buf.match(/\* SEARCH([\d ]*)/)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
        if (ids.length === 0) return finish([]);
        step = 4; buf = ''; send(`a4 FETCH ${ids[ids.length - 1]} BODY[TEXT]`); return;
      }
      if (step === 4 && /a4 (OK|NO|BAD)/.test(buf)) {
        for (const line of buf.split(/\r?\n/)) {
          const t = line.trim();
          if (/^(SPF|DKIM|DomainKeys|Sender-ID|"iprev")\s*check:/i.test(t) || /^Result:/i.test(t)) {
            out.push(t);
          }
        }
        return finish(out);
      }
    });

    socket.on('error', (err) => finish([`IMAP error: ${err.message}`]));
  });
}

async function main() {
  const problems = smtpConfigProblems();
  if (problems.length > 0) {
    console.error('SMTP is not configured:');
    for (const p of problems) console.error(`  ${p.field}: ${p.message}`);
    process.exit(1);
  }

  console.log(`Sending an authentication probe to ${VERIFIER} ...`);
  await deliverBySmtp({
    to: VERIFIER,
    toName: 'Authentication verifier',
    from: process.env.EMAIL_FROM_ADDRESS!,
    fromName: process.env.EMAIL_FROM_NAME ?? 'Bright Thoughts Services',
    replyTo: null,
    subject: 'Authentication check',
    body: 'Automated authentication check. No reply is needed.',
  });

  console.log('Sent. Reading the reply from the sending mailbox over IMAP ...\n');
  const lines = await imapFetchVerifierReply();

  if (lines.length === 0) {
    console.log('No reply from the verifier yet. It usually answers within a minute;');
    console.log('run this again shortly.');
    return;
  }
  for (const line of lines) console.log(`  ${line}`);
  console.log('\nA "pass" on SPF and DKIM means receiving servers can authenticate');
  console.log('this sender. It does not mean messages will reach the inbox: that is');
  console.log('reputation, which is earned by recipients engaging with real mail.');
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
