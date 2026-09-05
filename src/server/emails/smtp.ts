import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/lib/env';

/**
 * SMTP delivery.
 *
 * Built for Spacemail (Spaceship's email hosting), which is how mail actually
 * leaves this application. Worth being explicit about a common confusion:
 * **the Spaceship API cannot send email.** It manages domains and DNS
 * (`https://spaceship.dev/api/v1/`, `X-Api-Key` + `X-Api-Secret`). Sending goes
 * over SMTP to `mail.spacemail.com`, authenticated with a full mailbox address
 * and its password.
 *
 * The Spaceship API is still useful here, but for the step *before* sending:
 * confirming the SPF, DKIM and DMARC records exist on the sending domain. See
 * `src/server/emails/dns-readiness.ts`.
 *
 * Nothing in this file decides *whether* to send. By the time `deliverBySmtp`
 * is called the eleven send gates have already passed and a second person has
 * approved the message.
 */

export const SPACEMAIL_DEFAULTS = {
  host: 'mail.spacemail.com',
  /** 465 wraps the connection in TLS immediately; 587 upgrades with STARTTLS. */
  implicitTlsPort: 465,
  starttlsPort: 587,
} as const;

export interface OutgoingMessage {
  to: string;
  toName: string;
  from: string;
  fromName: string;
  replyTo: string | null;
  subject: string;
  body: string;
}

export interface SmtpConfigProblem {
  field: string;
  message: string;
}

/**
 * Checks the configuration is complete and internally consistent *before* a
 * send is attempted, so a misconfiguration surfaces as a clear message rather
 * than a connection error in the middle of an approved send.
 */
export function smtpConfigProblems(): SmtpConfigProblem[] {
  const problems: SmtpConfigProblem[] = [];

  if (!env.SMTP_HOST) {
    problems.push({ field: 'SMTP_HOST', message: 'Not set. For Spacemail use mail.spacemail.com.' });
  }
  if (!env.SMTP_PORT) {
    problems.push({
      field: 'SMTP_PORT',
      message: 'Not set. Use 465 for implicit TLS, or 587 for STARTTLS.',
    });
  } else if (![465, 587, 25, 2525].includes(env.SMTP_PORT)) {
    problems.push({
      field: 'SMTP_PORT',
      message: `Port ${env.SMTP_PORT} is unusual for submission. Expected 465 or 587.`,
    });
  }
  if (!env.SMTP_USER) {
    problems.push({
      field: 'SMTP_USER',
      message: 'Not set. Spacemail authenticates with the full mailbox address.',
    });
  } else if (!env.SMTP_USER.includes('@')) {
    problems.push({
      field: 'SMTP_USER',
      message: 'Must be the full mailbox address, not just the local part.',
    });
  }
  if (!env.SMTP_PASSWORD) {
    problems.push({ field: 'SMTP_PASSWORD', message: 'Not set.' });
  }
  if (!env.EMAIL_FROM_ADDRESS) {
    problems.push({
      field: 'EMAIL_FROM_ADDRESS',
      message: 'Not set. Recipients need a real address to reply to.',
    });
  }

  // A From address on a different domain to the authenticated mailbox is the
  // most common cause of silent spam-foldering, so it is worth saying plainly.
  if (env.SMTP_USER && env.EMAIL_FROM_ADDRESS) {
    const authDomain = env.SMTP_USER.split('@')[1]?.toLowerCase();
    const fromDomain = env.EMAIL_FROM_ADDRESS.split('@')[1]?.toLowerCase();
    if (authDomain && fromDomain && authDomain !== fromDomain) {
      problems.push({
        field: 'EMAIL_FROM_ADDRESS',
        message:
          `The From domain (${fromDomain}) differs from the authenticated mailbox domain ` +
          `(${authDomain}). Most providers will reject this or mark it as spam.`,
      });
    }
  }

  return problems;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const port = env.SMTP_PORT ?? SPACEMAIL_DEFAULTS.implicitTlsPort;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST ?? SPACEMAIL_DEFAULTS.host,
    port,
    // 465 is implicit TLS; anything else negotiates STARTTLS.
    secure: port === 465,
    auth: { user: env.SMTP_USER ?? '', pass: env.SMTP_PASSWORD ?? '' },
    requireTLS: port !== 465,
    // One message at a time: outreach volume is low and deliverability is
    // better served by pacing than by throughput.
    pool: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transporter;
}

/** Opens a connection and authenticates, without sending anything. */
export async function verifySmtpConnection(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const problems = smtpConfigProblems();
  if (problems.length > 0) {
    return {
      ok: false,
      error: problems.map((p) => `${p.field}: ${p.message}`).join(' · '),
    };
  }
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Sends one message and returns the provider's message id.
 *
 * Throws on any failure. The caller records the failure against the draft and
 * leaves it unsent, so a transient problem never looks like a delivered message.
 */
export async function deliverBySmtp(message: OutgoingMessage): Promise<string> {
  const problems = smtpConfigProblems();
  if (problems.length > 0) {
    throw new Error(
      `SMTP is selected but not correctly configured: ${problems
        .map((p) => `${p.field} — ${p.message}`)
        .join('; ')}`,
    );
  }

  const info = await getTransporter().sendMail({
    from: { name: message.fromName, address: env.EMAIL_FROM_ADDRESS },
    to: message.toName ? { name: message.toName, address: message.to } : message.to,
    replyTo: message.replyTo ?? message.from,
    subject: message.subject,
    // Plain text only. These are one-to-one business messages, and plain text
    // avoids both the tracking-pixel question and the HTML rendering lottery.
    text: message.body,
    headers: {
      /**
       * A recipient who wants out must be able to get out without composing a
       * reply, and mail providers check for exactly this. Gmail and Yahoo have
       * required an unsubscribe mechanism from bulk senders since February
       * 2024, and its absence is a strong negative signal — but the better
       * reason is that this application already records `optedOut` on a
       * contact and refuses to send to them. Tracking opt-outs while offering
       * no way to opt out is the wrong half of the feature.
       *
       * mailto: is used rather than one-click HTTPS because one-click requires
       * a public POST endpoint that honours the request without confirmation.
       * That is worth building once the application is deployed; promising
       * one-click without it would be worse than not offering it.
       */
      'List-Unsubscribe': `<mailto:${env.EMAIL_FROM_ADDRESS}?subject=unsubscribe>`,
    },
  });

  if (info.rejected?.length) {
    throw new Error(`The server rejected the recipient: ${info.rejected.join(', ')}`);
  }
  return info.messageId ?? `smtp-${Date.now()}`;
}

/** Drops the cached transporter. Used after a configuration change. */
export function resetSmtpTransport(): void {
  transporter?.close?.();
  transporter = null;
}
