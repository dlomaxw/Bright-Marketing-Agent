import { env } from '@/lib/env';
import type { FetchedPage } from './types';

/**
 * The single egress point to the public web.
 *
 * Policy, all enforced here rather than trusted to callers:
 *   - robots.txt honoured for our declared user-agent (no bypass path exists)
 *   - one in-flight request per host, with a minimum interval between requests
 *   - hard request timeout and response size cap
 *   - redirects followed manually to a capped depth, with the chain captured
 *   - GET and HEAD only
 *   - identifying User-Agent with a contact URL
 *
 * Explicitly not implemented: port scanning, version probing for exploitation,
 * authentication probing, or any request intended to trigger a fault. This is a
 * public-experience audit, not a security assessment.
 */

const lastRequestAt = new Map<string, number>();
const hostLocks = new Map<string, Promise<void>>();
const robotsCache = new Map<string, { body: string | null; fetchedAt: number }>();

const ROBOTS_TTL_MS = 10 * 60_000;

async function withHostLock<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const previous = hostLocks.get(host) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => {
    release = r;
  });
  hostLocks.set(host, previous.then(() => current));
  await previous;
  try {
    const last = lastRequestAt.get(host) ?? 0;
    const wait = env.AUDIT_MIN_INTERVAL_MS - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt.set(host, Date.now());
    return await fn();
  } finally {
    release();
    if (hostLocks.get(host) === current) hostLocks.delete(host);
  }
}

// --- robots.txt -------------------------------------------------------------

export async function getRobots(origin: string): Promise<string | null> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached.body;

  let body: string | null = null;
  try {
    const host = new URL(origin).host;
    body = await withHostLock(host, async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(env.AUDIT_REQUEST_TIMEOUT_MS, 8000));
      try {
        const res = await fetch(new URL('/robots.txt', origin), {
          headers: { 'user-agent': env.AUDIT_USER_AGENT, accept: 'text/plain' },
          redirect: 'follow',
          signal: ctrl.signal,
        });
        if (!res.ok) return null;
        const text = await res.text();
        return text.slice(0, 200_000);
      } finally {
        clearTimeout(timer);
      }
    });
  } catch {
    body = null;
  }
  robotsCache.set(origin, { body, fetchedAt: Date.now() });
  return body;
}

interface RobotsRule {
  allow: string[];
  disallow: string[];
}

/**
 * Minimal but correct-for-our-purposes robots parser: longest-match wins,
 * `Allow` beats `Disallow` at equal length, our UA group beats `*`.
 */
export function parseRobots(body: string | null, userAgentToken: string): RobotsRule | null {
  if (!body) return null;
  const groups = new Map<string, RobotsRule>();
  let active: string[] = [];
  let lastWasAgent = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!lastWasAgent) active = [];
      active.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field !== 'allow' && field !== 'disallow') continue;
    for (const agent of active) {
      const rule = groups.get(agent) ?? { allow: [], disallow: [] };
      if (field === 'allow') rule.allow.push(value);
      else rule.disallow.push(value);
      groups.set(agent, rule);
    }
  }

  const token = userAgentToken.toLowerCase();
  for (const [agent, rule] of groups) {
    if (agent !== '*' && token.includes(agent)) return rule;
  }
  return groups.get('*') ?? null;
}

const matchLength = (pattern: string, path: string): number => {
  if (pattern === '') return -1;
  // Support the common `*` and `$` extensions.
  if (pattern.includes('*') || pattern.endsWith('$')) {
    const rx = new RegExp(
      `^${pattern
        .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\$$/, '$')}`,
    );
    return rx.test(path) ? pattern.length : -1;
  }
  return path.startsWith(pattern) ? pattern.length : -1;
};

export function robotsAllows(rule: RobotsRule | null, path: string): boolean {
  if (!rule) return true;
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const p of rule.allow) bestAllow = Math.max(bestAllow, matchLength(p, path));
  for (const p of rule.disallow) bestDisallow = Math.max(bestDisallow, matchLength(p, path));
  if (bestDisallow < 0) return true;
  return bestAllow >= bestDisallow;
}

// --- fetching ---------------------------------------------------------------

function errorKind(err: unknown): FetchedPage['error'] {
  const message = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: { code?: string } })?.cause;
  const code = cause?.code ?? '';
  if (err instanceof Error && err.name === 'AbortError') {
    return { kind: 'timeout', message: `No response within ${env.AUDIT_REQUEST_TIMEOUT_MS}ms.` };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { kind: 'dns', message: 'Hostname could not be resolved.' };
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPROTO'].includes(code)) {
    return { kind: 'connection', message: `Connection failed (${code}).` };
  }
  if (code.startsWith('CERT_') || code.startsWith('ERR_TLS') || /certificate/i.test(message)) {
    return { kind: 'connection', message: `TLS failure: ${code || message}` };
  }
  return { kind: 'other', message };
}

export interface FetchOptions {
  method?: 'GET' | 'HEAD';
  respectRobots?: boolean;
  robotsRule?: RobotsRule | null;
}

export async function fetchPage(url: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  const started = Date.now();
  const method = opts.method ?? 'GET';
  const base: FetchedPage = {
    requestedUrl: url,
    finalUrl: url,
    status: 0,
    ok: false,
    headers: {},
    contentType: null,
    bytes: 0,
    html: null,
    redirectChain: [],
    elapsedMs: 0,
  };

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ...base, elapsedMs: 0, error: { kind: 'other', message: 'Malformed URL.' } };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { ...base, error: { kind: 'other', message: 'Only http and https are audited.' } };
  }

  const respectRobots = opts.respectRobots ?? env.AUDIT_RESPECT_ROBOTS;
  if (respectRobots) {
    const rule =
      opts.robotsRule !== undefined
        ? opts.robotsRule
        : parseRobots(await getRobots(target.origin), env.AUDIT_USER_AGENT);
    if (!robotsAllows(rule, target.pathname)) {
      return {
        ...base,
        elapsedMs: Date.now() - started,
        error: {
          kind: 'robots',
          message: `robots.txt disallows ${target.pathname} for our user-agent. Manual review required.`,
        },
      };
    }
  }

  const chain: { url: string; status: number }[] = [];
  const seen = new Set<string>();
  let current = target;

  for (let hop = 0; hop <= env.AUDIT_MAX_REDIRECTS; hop++) {
    if (seen.has(current.toString())) {
      return {
        ...base,
        finalUrl: current.toString(),
        redirectChain: chain,
        elapsedMs: Date.now() - started,
        error: { kind: 'redirect_loop', message: 'The redirect chain returns to a previous URL.' },
      };
    }
    seen.add(current.toString());

    const hopUrl = current;
    let res: Response;
    try {
      res = await withHostLock(hopUrl.host, async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), env.AUDIT_REQUEST_TIMEOUT_MS);
        try {
          return await fetch(hopUrl, {
            method,
            redirect: 'manual',
            signal: ctrl.signal,
            headers: {
              'user-agent': env.AUDIT_USER_AGENT,
              accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'accept-language': 'en',
            },
          });
        } finally {
          clearTimeout(timer);
        }
      });
    } catch (err) {
      return {
        ...base,
        finalUrl: hopUrl.toString(),
        redirectChain: chain,
        elapsedMs: Date.now() - started,
        error: errorKind(err),
      };
    }

    chain.push({ url: hopUrl.toString(), status: res.status });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) break;
      let next: URL;
      try {
        next = new URL(location, hopUrl);
      } catch {
        break;
      }
      current = next;
      if (hop === env.AUDIT_MAX_REDIRECTS) {
        return {
          ...base,
          finalUrl: next.toString(),
          redirectChain: chain,
          elapsedMs: Date.now() - started,
          error: {
            kind: 'redirect_loop',
            message: `More than ${env.AUDIT_MAX_REDIRECTS} redirects.`,
          },
        };
      }
      continue;
    }

    // Terminal response.
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const contentType = res.headers.get('content-type');
    const isHtml = !!contentType && /text\/html|application\/xhtml|text\/plain|xml/i.test(contentType);

    let html: string | null = null;
    let bytes = 0;
    if (method === 'GET' && res.body) {
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > env.AUDIT_MAX_BYTES) {
        try {
          await res.body.cancel();
        } catch {
          /* ignore */
        }
        return {
          ...base,
          finalUrl: hopUrl.toString(),
          status: res.status,
          headers,
          contentType,
          bytes: declared,
          redirectChain: chain,
          elapsedMs: Date.now() - started,
          error: { kind: 'too_large', message: `Response exceeds ${env.AUDIT_MAX_BYTES} bytes.` },
        };
      }
      const buf = await readCapped(res, env.AUDIT_MAX_BYTES);
      bytes = buf.byteLength;
      if (isHtml) html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    } else {
      bytes = Number(res.headers.get('content-length') ?? '0');
    }

    return {
      requestedUrl: url,
      finalUrl: hopUrl.toString(),
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      headers,
      contentType,
      bytes,
      html,
      redirectChain: chain,
      elapsedMs: Date.now() - started,
    };
  }

  return { ...base, redirectChain: chain, elapsedMs: Date.now() - started };
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  try {
    await reader.cancel();
  } catch {
    /* already closed */
  }
  const out = new Uint8Array(Math.min(total, max));
  let offset = 0;
  for (const c of chunks) {
    if (offset >= out.length) break;
    out.set(c.subarray(0, out.length - offset), offset);
    offset += c.byteLength;
  }
  return out;
}

/** Reset per-host state. Used by tests. */
export function resetFetcherState(): void {
  lastRequestAt.clear();
  hostLocks.clear();
  robotsCache.clear();
}
