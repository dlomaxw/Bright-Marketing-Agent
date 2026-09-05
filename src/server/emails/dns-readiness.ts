import { Resolver } from 'node:dns/promises';
import { env, integrations } from '@/lib/env';

/**
 * Sending-domain readiness.
 *
 * The Spaceship API manages domains and DNS — it cannot send email. That makes
 * it exactly the right tool for the step before sending: confirming the sending
 * domain publishes SPF, DKIM and DMARC. Without those, outreach lands in spam
 * folders, and a campaign that silently fails is worse than one that never ran,
 * because nobody knows to fix it.
 *
 * Records are read over public DNS, which is the same view a receiving mail
 * server gets — the authoritative answer. The Spaceship API is used to report
 * what the zone is *configured* to publish, which is what you would edit to fix
 * a problem. Neither call sends anything.
 */

export interface DnsCheck {
  key: 'spf' | 'dkim' | 'dmarc' | 'mx';
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'unknown';
  detail: string;
  /** The record as published, when one was found. */
  record?: string;
}

export interface DomainReadiness {
  domain: string;
  checks: DnsCheck[];
  readyToSend: boolean;
  blockers: string[];
  summary: string;
}

/**
 * Each resolver is queried independently, and the first positive answer wins.
 *
 * A single Resolver with several servers does NOT do this: Node falls through
 * to the next server only on a network error, so an `ENODATA` from the first
 * one ends the lookup. A resolver still holding a negative cache entry for a
 * freshly published record therefore produced "record not found" — a false
 * negative in the exact tool meant to prevent false conclusions. Asking each
 * one separately means a record has to be absent everywhere to be reported
 * absent.
 */
const RESOLVER_SERVERS = ['8.8.8.8', '1.1.1.1', '9.9.9.9'];

function resolverFor(server: string): Resolver {
  const resolver = new Resolver();
  resolver.setServers([server]);
  return resolver;
}

async function txt(name: string): Promise<string[]> {
  for (const server of RESOLVER_SERVERS) {
    try {
      const records = await resolverFor(server).resolveTxt(name);
      const joined = records.map((chunks) => chunks.join(''));
      if (joined.length > 0) return joined;
    } catch {
      // Try the next resolver: an absent record and a stale negative cache
      // entry are indistinguishable from a single server's answer.
    }
  }
  return [];
}

/** MX lookups get the same per-resolver treatment as TXT, for the same reason. */
async function mxRecords(name: string): Promise<{ exchange: string; priority: number }[]> {
  for (const server of RESOLVER_SERVERS) {
    try {
      const records = await resolverFor(server).resolveMx(name);
      if (records.length > 0) return records;
    } catch {
      // Next resolver.
    }
  }
  return [];
}

/**
 * Checks the sending domain against what receiving servers actually look for.
 *
 * `dkimSelector` defaults to Spacemail's. A wrong selector reports DKIM as not
 * found, which is why the detail says which selector was checked rather than
 * asserting the record is absent.
 */
export async function checkSendingDomain(
  domain: string,
  dkimSelector = 'spacemail',
): Promise<DomainReadiness> {
  const checks: DnsCheck[] = [];
  const clean = domain.trim().toLowerCase().replace(/^www\./, '');

  // --- MX -------------------------------------------------------------------
  try {
    const mx = await mxRecords(clean);
    checks.push(
      mx.length > 0
        ? {
            key: 'mx',
            label: 'Mail exchanger',
            status: 'pass',
            detail: `${mx.length} MX record(s): ${mx.map((m) => m.exchange).join(', ')}`,
          }
        : {
            key: 'mx',
            label: 'Mail exchanger',
            status: 'warn',
            detail: 'No MX records. The domain can still send, but cannot receive replies.',
          },
    );
  } catch {
    checks.push({
      key: 'mx',
      label: 'Mail exchanger',
      status: 'warn',
      detail: 'No MX records found. Replies to this domain would not be delivered.',
    });
  }

  // --- SPF ------------------------------------------------------------------
  const rootTxt = await txt(clean);
  const spf = rootTxt.find((r) => r.toLowerCase().startsWith('v=spf1'));
  if (!spf) {
    checks.push({
      key: 'spf',
      label: 'SPF',
      status: 'fail',
      detail:
        'No SPF record. Receiving servers cannot confirm this domain authorised the sender, so mail is likely to be treated as spam.',
    });
  } else {
    const permissive = /[?+]all\s*$/.test(spf);
    checks.push({
      key: 'spf',
      label: 'SPF',
      status: permissive ? 'warn' : 'pass',
      detail: permissive
        ? 'SPF is published but ends in a permissive qualifier, which weakens it. Prefer "~all" or "-all".'
        : 'SPF is published.',
      record: spf,
    });
  }

  // --- DKIM -----------------------------------------------------------------
  const dkim = await txt(`${dkimSelector}._domainkey.${clean}`);
  const dkimRecord = dkim.find((r) => r.toLowerCase().includes('v=dkim1') || r.includes('p='));
  checks.push(
    dkimRecord
      ? {
          key: 'dkim',
          label: 'DKIM',
          status: 'pass',
          detail: `A DKIM key is published for the "${dkimSelector}" selector.`,
          record: `${dkimRecord.slice(0, 60)}…`,
        }
      : {
          key: 'dkim',
          label: 'DKIM',
          status: 'fail',
          detail:
            `No DKIM key found at ${dkimSelector}._domainkey.${clean}. ` +
            'Either it is not published, or the selector differs — check the selector in the Spacemail settings before concluding it is missing.',
        },
  );

  // --- DMARC ----------------------------------------------------------------
  const dmarcTxt = await txt(`_dmarc.${clean}`);
  const dmarc = dmarcTxt.find((r) => r.toLowerCase().startsWith('v=dmarc1'));
  if (!dmarc) {
    checks.push({
      key: 'dmarc',
      label: 'DMARC',
      status: 'fail',
      detail:
        'No DMARC record. Without one, receiving servers have no instruction for messages that fail SPF or DKIM.',
    });
  } else {
    const policy = dmarc.match(/p=(none|quarantine|reject)/i)?.[1]?.toLowerCase();
    checks.push({
      key: 'dmarc',
      label: 'DMARC',
      status: policy === 'none' ? 'warn' : 'pass',
      detail:
        policy === 'none'
          ? 'DMARC is published with p=none, which only monitors. Move to quarantine or reject once reports look clean.'
          : `DMARC is published with p=${policy}.`,
      record: dmarc,
    });
  }

  const blockers = checks.filter((c) => c.status === 'fail').map((c) => `${c.label}: ${c.detail}`);
  const warnings = checks.filter((c) => c.status === 'warn');

  return {
    domain: clean,
    checks,
    readyToSend: blockers.length === 0,
    blockers,
    summary:
      blockers.length === 0
        ? warnings.length > 0
          ? `${clean} is configured to send, with ${warnings.length} item(s) worth improving.`
          : `${clean} publishes SPF, DKIM and DMARC.`
        : `${clean} is not ready to send: ${blockers.length} record(s) missing.`,
  };
}

// ---------------------------------------------------------------------------
// Spaceship DNS (optional)
// ---------------------------------------------------------------------------

const SPACESHIP_BASE = 'https://spaceship.dev/api/v1';

export interface SpaceshipDnsRecord {
  type: string;
  name: string;
  value: string;
  ttl?: number;
}

export interface SpaceshipResult {
  configured: boolean;
  ok: boolean;
  records: SpaceshipDnsRecord[];
  message: string;
}

/**
 * Reads the DNS records Spaceship holds for a domain.
 *
 * This shows what the zone is configured to publish, which is what you would
 * edit to fix a readiness failure. Public DNS remains the source of truth for
 * whether a record is actually live.
 */
export async function fetchSpaceshipDnsRecords(domain: string): Promise<SpaceshipResult> {
  if (!integrations.spaceship) {
    return {
      configured: false,
      ok: false,
      records: [],
      message:
        'Spaceship is not configured. The API needs BOTH SPACESHIP_API_KEY and SPACESHIP_API_SECRET — it authenticates with X-Api-Key and X-Api-Secret headers.',
    };
  }

  try {
    const res = await fetch(
      `${SPACESHIP_BASE}/dns/records/${encodeURIComponent(domain)}?take=100&skip=0`,
      {
        headers: {
          'X-Api-Key': env.SPACESHIP_API_KEY,
          'X-Api-Secret': env.SPACESHIP_API_SECRET,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!res.ok) {
      const detail = await res.text();
      return {
        configured: true,
        ok: false,
        records: [],
        message:
          res.status === 401 || res.status === 403
            ? `Spaceship rejected the credentials (HTTP ${res.status}). Check the API key and secret, and that the key is authorised for this domain.`
            : `Spaceship returned HTTP ${res.status}. ${detail.slice(0, 200)}`,
      };
    }

    const payload = (await res.json()) as {
      items?: { type?: string; name?: string; value?: string; address?: string; ttl?: number }[];
    };

    const records = (payload.items ?? []).map((r) => ({
      type: r.type ?? 'UNKNOWN',
      name: r.name ?? '@',
      value: r.value ?? r.address ?? '',
      ttl: r.ttl,
    }));

    return {
      configured: true,
      ok: true,
      records,
      message: `Spaceship holds ${records.length} DNS record(s) for ${domain}.`,
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      records: [],
      message: `Could not reach the Spaceship API: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
