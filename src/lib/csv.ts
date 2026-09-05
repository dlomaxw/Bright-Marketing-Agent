/**
 * RFC 4180 CSV parser and writer. Small enough to own rather than depend on:
 * imports are a trust boundary and we want the exact failure behaviour.
 */

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // Strip a UTF-8 BOM, which Excel writes by default.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  while (i < text.length) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

export interface CsvTable {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsvTable(input: string): CsvTable {
  const raw = parseCsv(input);
  const headerRow = raw[0];
  if (!headerRow) return { headers: [], rows: [] };
  const headers = headerRow.map((h) => h.trim());
  const rows = raw.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = (cells[idx] ?? '').trim();
    });
    return record;
  });
  return { headers, rows };
}

const escapeCell = (value: unknown): string => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return columns ? `${columns.join(',')}\n` : '';
  const headers = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => escapeCell(row[h])).join(','));
  return `${lines.join('\n')}\n`;
}

/**
 * Fuzzy header matching for the import mapper. Handles the column names in the
 * reference dataset ("Organization", "Sales offer", "Public source URL") as well
 * as common variants.
 */
const FIELD_ALIASES: Record<string, string[]> = {
  legalName: ['organization', 'organisation', 'company', 'business', 'name', 'legal name', 'business name', 'client'],
  brandName: ['brand', 'brand name', 'trading name'],
  industry: ['industry', 'sector', 'category', 'vertical'],
  website: ['website', 'url', 'web', 'site', 'domain', 'web address'],
  country: ['country'],
  city: ['city', 'town', 'location', 'district'],
  contactName: ['contact', 'contact name', 'person', 'decision maker', 'contact person'],
  contactRole: ['role', 'title', 'position', 'job title'],
  contactEmail: ['email', 'e-mail', 'contact email', 'email address'],
  contactPhone: ['phone', 'telephone', 'mobile', 'contact phone', 'phone number', 'tel'],
  whatsapp: ['whatsapp', 'whats app', 'wa'],
  importedScore: ['score', 'rating', 'priority score'],
  issue: ['status', 'issue', 'status / issue', 'problem', 'finding', 'observation', 'status/issue'],
  salesOffer: ['sales offer', 'offer', 'recommended service', 'service', 'solution'],
  sourceUrl: ['public source url', 'source', 'source url', 'evidence url', 'reference'],
  notes: ['notes', 'note', 'comment', 'comments', 'remarks'],
  tags: ['tags', 'tag', 'labels'],
  facebook: ['facebook', 'fb'],
  instagram: ['instagram', 'ig'],
  linkedin: ['linkedin'],
  x: ['x', 'twitter'],
  tiktok: ['tiktok'],
  youtube: ['youtube'],
  googleBusiness: ['google business', 'gbp', 'google my business', 'google maps'],
};

export function suggestMapping(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const used = new Set<string>();

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const match = headers.find((h) => {
      if (used.has(h)) return false;
      const norm = h.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      return aliases.includes(norm);
    });
    mapping[field] = match ?? null;
    if (match) used.add(match);
  }
  return mapping;
}

export const IMPORT_FIELDS = Object.keys(FIELD_ALIASES);
