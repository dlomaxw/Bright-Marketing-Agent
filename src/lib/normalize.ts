/**
 * Normalization used for duplicate detection and for anything that compares
 * user-entered identifiers. Every dedupe key in the database is produced here,
 * so these functions must stay pure and stable.
 */

/**
 * A hostname is usable if it is a registrable name (contains a dot), an IP
 * literal, or `localhost`. Localhost is allowed deliberately: the audit fixture
 * site runs there, and rejecting it would make the engine untestable locally.
 */
function isUsableHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.startsWith('[') && host.endsWith(']')) return true; // IPv6 literal
  return host.includes('.') && host.length >= 4;
}

/** Strip scheme, credentials, www, port, path, query and case from a URL or bare host. */
export function domainKey(input: string | null | undefined): string | null {
  if (!input) return null;
  let raw = input.trim().toLowerCase();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) raw = `http://${raw}`;
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  if (!isUsableHost(host)) return null;
  return host;
}

/** Canonical absolute URL for storage and display. Returns null if unusable. */
export function normalizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let raw = input.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!isUsableHost(u.hostname)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function isValidUrl(input: string | null | undefined): boolean {
  return normalizeUrl(input) !== null;
}

/** Lowercase, collapse whitespace, drop punctuation and common company suffixes. */
export function nameKey(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD') // decompose accents; the class below drops the marks
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(
      /\b(ltd|limited|llc|inc|incorporated|plc|co|company|corp|corporation|group|holdings|enterprises|services|solutions|uganda|u)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function emailKey(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  // Deliberately permissive: we validate deliverability separately, this is a key.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) return null;
  return v;
}

export function isValidEmail(input: string | null | undefined): boolean {
  return emailKey(input) !== null;
}

/**
 * Best-effort E.164 for duplicate detection. `defaultCountryCode` is applied to
 * national-format numbers; Uganda (256) is the product default.
 */
export function phoneKey(
  input: string | null | undefined,
  defaultCountryCode = '256',
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const hadPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (!hadPlus) {
    // 0772123456 -> 256772123456
    if (digits.startsWith('0')) digits = defaultCountryCode + digits.slice(1);
    else if (!digits.startsWith(defaultCountryCode) && digits.length <= 10) {
      digits = defaultCountryCode + digits;
    }
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/** Placeholder phone patterns used by the CMS-residue checks. */
const PLACEHOLDER_PHONE = [
  /\b555[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\b123[-.\s]?456[-.\s]?7890\b/,
  /\b\(?000\)?[-.\s]?000[-.\s]?0000\b/,
  /\b1234567890\b/,
  /\b\+1\s?800\s?555\s?0199\b/,
];

export function looksLikePlaceholderPhone(text: string): boolean {
  return PLACEHOLDER_PHONE.some((r) => r.test(text));
}

/** Reserved / example domains that must never be treated as a real prospect site. */
const RESERVED_DOMAIN = /(^|\.)(example|test|invalid|localhost|local)(\.|$)/i;

export function isReservedDomain(host: string | null | undefined): boolean {
  if (!host) return false;
  return RESERVED_DOMAIN.test(host);
}

export function looksLikePlaceholderEmail(text: string): boolean {
  return /\b[\w.+-]+@(example\.(com|org|net)|domain\.com|yourdomain\.com|email\.com|test\.com)\b/i.test(
    text,
  );
}

export function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
