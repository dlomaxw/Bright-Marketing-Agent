import tls from 'node:tls';
import { env } from '@/lib/env';

/**
 * Files a copy of a sent message in the mailbox's Sent folder.
 *
 * SMTP hands a message to a server for delivery and nothing else. It does not
 * touch the sender's mailbox, so a message sent by this application is
 * genuinely invisible in Spacemail: the recipient has it, and the person whose
 * address it came from has no record of it at all. That is a bad position to be
 * in when a client replies about something you cannot see you sent.
 *
 * Putting it in Sent is a separate IMAP APPEND, which is what a mail client
 * does after its own SMTP handoff.
 *
 * Failure here never fails the send. The message has already been accepted for
 * delivery by that point, and reporting a delivered message as failed would be
 * a worse lie than a missing copy — the outbox and activity log still hold the
 * record either way.
 */

export interface SentCopyResult {
  ok: boolean;
  folder?: string;
  reason?: string;
}

/** Folders to try, in order. Servers differ on naming. */
const CANDIDATE_FOLDERS = ['Sent', 'INBOX.Sent', 'Sent Items', 'Sent Messages'];

/** RFC 2047 encoding, so a subject with an em dash or an accent survives. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function formatAddress(name: string, address: string): string {
  return name ? `${encodeHeader(name)} <${address}>` : address;
}

/**
 * Builds the RFC 822 message to file.
 *
 * The Message-ID and Date are passed in rather than generated here, so the
 * copy carries the same identity as the message that actually went out. A copy
 * with a different Message-ID would not thread with the reply.
 */
export function buildRfc822(message: {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  replyTo: string | null;
  subject: string;
  body: string;
  messageId: string;
  date: Date;
  headers?: Record<string, string>;
}): string {
  const headers = [
    `From: ${formatAddress(message.fromName, message.from)}`,
    `To: ${formatAddress(message.toName, message.to)}`,
    ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${message.date.toUTCString()}`,
    `Message-ID: ${message.messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    // Base64 avoids every line-length and non-ASCII question in one step.
    'Content-Transfer-Encoding: base64',
    ...Object.entries(message.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
  ];

  const encoded = Buffer.from(message.body, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');

  return `${headers.join('\r\n')}\r\n\r\n${encoded}\r\n`;
}

export function sentCopyConfigured(): boolean {
  return Boolean(env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_HOST);
}

export function appendToSentFolder(raw: string): Promise<SentCopyResult> {
  return new Promise((resolve) => {
    if (!sentCopyConfigured()) {
      resolve({ ok: false, reason: 'IMAP credentials are not configured, so no copy was filed.' });
      return;
    }

    const host = env.IMAP_HOST || env.SMTP_HOST!;
    const port = env.IMAP_PORT || 993;
    const user = env.SMTP_USER!;
    const pass = env.SMTP_PASSWORD!;

    const socket = tls.connect({ host, port, servername: host });
    const literal = Buffer.byteLength(raw, 'utf8');

    let buf = '';
    let step = 0;
    let folderIndex = 0;
    let settled = false;

    const send = (line: string) => socket.write(`${line}\r\n`);
    const finish = (result: SentCopyResult) => {
      if (settled) return;
      settled = true;
      try {
        socket.end();
      } catch {
        // Already closed.
      }
      resolve(result);
    };

    socket.setTimeout(20_000, () => finish({ ok: false, reason: 'IMAP timed out.' }));

    const tryNextFolder = () => {
      if (folderIndex >= CANDIDATE_FOLDERS.length) {
        finish({
          ok: false,
          reason: `No Sent folder accepted the copy. Tried: ${CANDIDATE_FOLDERS.join(', ')}.`,
        });
        return;
      }
      const folder = CANDIDATE_FOLDERS[folderIndex];
      buf = '';
      step = 2;
      send(`a2 APPEND "${folder}" (\\Seen) {${literal}}`);
    };

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');

      if (step === 0 && buf.includes('* OK')) {
        step = 1;
        buf = '';
        send(`a1 LOGIN "${user}" "${pass}"`);
        return;
      }

      if (step === 1 && /a1 (OK|NO|BAD)/.test(buf)) {
        if (!/a1 OK/.test(buf)) {
          finish({ ok: false, reason: `IMAP login failed: ${buf.trim().slice(0, 120)}` });
          return;
        }
        tryNextFolder();
        return;
      }

      if (step === 2) {
        // The server answers a literal with a continuation request.
        if (buf.includes('+')) {
          step = 3;
          buf = '';
          socket.write(raw);
          socket.write('\r\n');
          return;
        }
        if (/a2 (NO|BAD)/.test(buf)) {
          folderIndex += 1;
          tryNextFolder();
          return;
        }
      }

      if (step === 3 && /a2 (OK|NO|BAD)/.test(buf)) {
        if (/a2 OK/.test(buf)) {
          finish({ ok: true, folder: CANDIDATE_FOLDERS[folderIndex] });
        } else {
          folderIndex += 1;
          tryNextFolder();
        }
      }
    });

    socket.on('error', (err) => finish({ ok: false, reason: `IMAP error: ${err.message}` }));
  });
}
