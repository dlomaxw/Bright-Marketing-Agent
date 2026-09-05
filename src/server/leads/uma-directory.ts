import { db } from '@/lib/db';
import {
  domainKey,
  emailKey,
  isValidEmail,
  nameKey,
  normalizeUrl,
  phoneKey,
} from '@/lib/normalize';
import { logActivity } from '@/server/activity';

/**
 * Uganda Manufacturers Association Business Directory importer.
 *
 * This is the real dataset the product was always meant to start from: ~1,400
 * named Ugandan manufacturers, published by UMA, with addresses, telephone
 * numbers, contact people and — for around 650 of them — a website.
 *
 * It is a citable source, which is what makes it usable here. Every record
 * imported carries its provenance (directory, edition, page), so any finding
 * later raised against one of these companies can be traced back to how we came
 * to know about the company in the first place.
 *
 * Two things this importer will not do:
 *
 *  - It will not store a contact detail it cannot read cleanly. The PDF's font
 *    encoding mangles ligatures, and a half-repaired email address is worse
 *    than a missing one, because someone might send to it. Unrepairable values
 *    are recorded in the note for a human to fix.
 *  - It will not mark anything verified. A printed directory shows what was
 *    true at publication. Contacts arrive `unverified`, exactly like every
 *    other imported contact.
 */

// ---------------------------------------------------------------------------
// Text repair
// ---------------------------------------------------------------------------

/**
 * The directory's PDF encodes ligatures as single code points that extract as
 * unrelated Latin Extended letters. Each mapping below was confirmed against
 * several occurrences in context, e.g. `BuƩer` -> `Butter`, `oĸce` -> `office`,
 * `smarƞoodsuganda` -> `smartfoodsuganda`.
 */
const LIGATURES: Record<string, string> = {
  'Ɵ': 'ti', // Ɵ  operaƟons -> operations
  'Ʃ': 'tt', // Ʃ  BuƩer -> Butter
  'Į': 'fi', // Į  Įsh -> fish
  'ī': 'ff', // ī  coīee -> coffee
  'Ō': 'ft', // Ō  liŌ -> lift
  'ƫ': 'tti', // ƫ cuƫngs -> cuttings
  'Ň': 'fl', // Ň  Ňavors -> flavors
  'ĸ': 'ffi', // ĸ oĸce -> office
  'ƞ': 'tf', // ƞ  smarƞoods -> smartfoods
  'ĩ': 'fb', // ĩ  hotloaĩakery -> hotloafbakery
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '•': '-',
};

export function repairLigatures(text: string): string {
  let out = text;
  for (const [from, to] of Object.entries(LIGATURES)) {
    out = out.split(from).join(to);
  }
  return out.replace(/�/g, '');
}

/** True when a value still contains characters we could not resolve. */
export function hasUnreadableCharacters(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[^\x20-\x7E]/.test(value);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface UmaEntry {
  name: string;
  page: number;
  address: string | null;
  poBox: string | null;
  phones: string[];
  whatsapp: string | null;
  emails: string[];
  unreadableEmails: string[];
  website: string | null;
  unreadableWebsite: string | null;
  contactPerson: string | null;
  designation: string | null;
  productsServices: string | null;
  brands: string | null;
}

const FIELD_LABELS = [
  'P.O.Box',
  'P.O. Box',
  'PO Box',
  'Tel',
  'Telephone',
  'WhatsApp',
  'Whatsapp',
  'Fax',
  'Email',
  'E-mail',
  'Contact Person',
  'Designation',
  'Website',
  'Web',
  'Facebook',
  'Twitter',
  'Instagram',
  'LinkedIn',
  'Products/Services',
  'Products / Services',
  'Brands',
  'Brand name',
];

const labelPattern = new RegExp(
  `^\\s*(${FIELD_LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})\\s*[:.]\\s*(.*)$`,
  'i',
);

/**
 * The directory interleaves member listings with full-page advertisements, and
 * advert headlines are also set in capitals ("REACH US TOLL-FREE AT", "BRANDS
 * WE DISTRIBUTE"). Capitalisation alone therefore cannot identify a company, so
 * headline-shaped lines are rejected explicitly.
 */
const ADVERT_OPENERS =
  /^(reach|call|visit|contact|buy|get|scan|follow|why|how|what|where|when|welcome|thank|order|shop|discover|introducing|available|proudly|now|new|free|save|our|your|we|us|the best|for all|talk to|find)\b/i;

const ADVERT_PHRASES = /\b(we |us |your |our |toll[- ]free|click|hotline|nationwide|countrywide)\b/i;

const TRAILING_PREPOSITION = /\b(at|to|for|with|in|on|from|by|and|or|of)$/i;

/** Legal or trading forms that make a line unambiguously a company name. */
const COMPANY_SUFFIX =
  /\b(ltd|limited|plc|llc|inc|co|company|companies|industries|industrial|enterprises?|group|holdings|manufacturers?|millers?|farms?|foods?|works|factory|factories|sacco|union|cooperative|society|agencies|traders?|investments?|international|uganda|\(u\))\b/i;

function looksLikeCompanyName(line: string): boolean {
  const trimmed = line.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 4 || trimmed.length > 120) return false;
  if (labelPattern.test(trimmed)) return false;

  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const upperShare = letters.replace(/[^A-Z]/g, '').length / letters.length;
  if (upperShare <= 0.75) return false;

  if (ADVERT_OPENERS.test(trimmed)) return false;
  if (ADVERT_PHRASES.test(trimmed)) return false;
  if (TRAILING_PREPOSITION.test(trimmed)) return false;
  // Registered names do not carry sentence punctuation.
  if (/[!?]/.test(trimmed)) return false;

  // A run of four or more short words with no company form reads as a slogan.
  const words = trimmed.split(' ');
  if (words.length >= 4 && !COMPANY_SUFFIX.test(trimmed)) return false;

  return true;
}

const collectPhones = (value: string): string[] => {
  const matches = value.match(/\+?[\d][\d\s()\-–/]{6,}\d/g) ?? [];
  return matches
    .map((m) => m.trim())
    .flatMap((m) => m.split(/\s*\/\s*/))
    .map((m) => m.trim())
    .filter((m) => m.replace(/\D/g, '').length >= 9);
};

const collectEmails = (value: string): string[] =>
  (value.match(/[^\s,/;]+@[^\s,/;]+/g) ?? []).map((e) => e.replace(/[.,;]+$/, '').trim());

/**
 * Splits the extracted directory text into member entries.
 *
 * Entries are separated by a run of underscores in the source layout. Each
 * begins with the company name in capitals, followed by labelled fields.
 */
export function parseUmaDirectory(rawText: string): UmaEntry[] {
  const text = repairLigatures(rawText);
  const pages = text.split(/-- (\d+) of \d+ --/);

  const entries: UmaEntry[] = [];

  // split() with a capture group yields [before, pageNo, after, pageNo, ...]
  for (let i = 0; i < pages.length; i += 2) {
    const body = pages[i] ?? '';
    const pageNumber = Number(pages[i + 1] ?? 0) || Math.ceil(i / 2) + 1;

    for (const block of body.split(/_{5,}/)) {
      const entry = parseBlock(block, pageNumber);
      if (entry) entries.push(entry);
    }
  }

  // The same company can be advertised and listed. Keep the richest record.
  const byKey = new Map<string, UmaEntry>();
  for (const entry of entries) {
    const key = nameKey(entry.name);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || score(entry) > score(existing)) byKey.set(key, entry);
  }
  return [...byKey.values()];
}

const score = (e: UmaEntry) =>
  (e.website ? 4 : 0) +
  e.emails.length * 2 +
  e.phones.length +
  (e.contactPerson ? 2 : 0) +
  (e.productsServices ? 1 : 0);

function parseBlock(block: string, page: number): UmaEntry | null {
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 3) return null;

  const nameIndex = lines.findIndex(looksLikeCompanyName);
  if (nameIndex < 0) return null;

  const name = lines[nameIndex]!.replace(/\s+/g, ' ').trim();

  const entry: UmaEntry = {
    name,
    page,
    address: null,
    poBox: null,
    phones: [],
    whatsapp: null,
    emails: [],
    unreadableEmails: [],
    website: null,
    unreadableWebsite: null,
    contactPerson: null,
    designation: null,
    productsServices: null,
    brands: null,
  };

  const addressParts: string[] = [];
  let currentLabel: string | null = null;
  const buffer: Record<string, string[]> = {};

  for (const line of lines.slice(nameIndex + 1)) {
    const match = line.match(labelPattern);
    if (match) {
      currentLabel = match[1]!.toLowerCase().replace(/\s+/g, '');
      (buffer[currentLabel] ??= []).push(match[2] ?? '');
      continue;
    }
    // Continuation of the previous field, or part of the address block.
    if (currentLabel) (buffer[currentLabel] ??= []).push(line);
    else addressParts.push(line);
  }

  const value = (...keys: string[]): string | null => {
    for (const key of keys) {
      const parts = buffer[key];
      if (parts && parts.length) return parts.join(' ').replace(/\s+/g, ' ').trim();
    }
    return null;
  };

  entry.address = addressParts.length ? addressParts.join(', ').replace(/\s+/g, ' ').trim() : null;
  entry.poBox = value('p.o.box', 'p.o.box', 'pobox');
  entry.contactPerson = value('contactperson');
  entry.designation = value('designation');
  entry.productsServices = value('products/services', 'products/services');
  entry.brands = value('brands', 'brandname');
  entry.whatsapp = value('whatsapp');

  const telRaw = [value('tel'), value('telephone'), entry.whatsapp].filter(Boolean).join(' ');
  entry.phones = [...new Set(collectPhones(telRaw))];

  const emailRaw = [value('email'), value('e-mail')].filter(Boolean).join(' ');
  for (const candidate of collectEmails(emailRaw)) {
    // A mangled address must never be presented as usable.
    if (hasUnreadableCharacters(candidate) || !isValidEmail(candidate)) {
      entry.unreadableEmails.push(candidate);
    } else {
      entry.emails.push(candidate.toLowerCase());
    }
  }
  entry.emails = [...new Set(entry.emails)];

  const webRaw = value('website', 'web');
  if (webRaw) {
    const first = webRaw.split(/\s+or\s+|[,;]/)[0]?.trim() ?? '';
    const cleaned = first.replace(/^https?:\/\//i, '').replace(/\/$/, '').trim();
    if (cleaned && !hasUnreadableCharacters(cleaned) && normalizeUrl(cleaned)) {
      entry.website = normalizeUrl(cleaned);
    } else if (cleaned) {
      entry.unreadableWebsite = cleaned;
    }
  }

  // A block with a name but no way to reach the company is a layout artefact,
  // not a directory entry.
  const usable = entry.phones.length || entry.emails.length || entry.website || entry.productsServices;
  return usable ? entry : null;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface UmaImportOptions {
  actorId: string;
  ownerId?: string | null;
  /** Import only entries that publish a website — the auditable ones. */
  websiteOnly?: boolean;
  limit?: number;
  dryRun?: boolean;
  edition?: string;
}

export interface UmaImportSummary {
  parsed: number;
  eligible: number;
  created: number;
  merged: number;
  skipped: number;
  withWebsite: number;
  needsContactRepair: number;
  examples: { name: string; website: string | null; status: string }[];
}

const SOURCE_URL = 'http://www.directory.uma.or.ug';

export async function importUmaDirectory(
  rawText: string,
  options: UmaImportOptions,
): Promise<UmaImportSummary> {
  const edition = options.edition ?? 'UMA Business Directory 2026';
  const entries = parseUmaDirectory(rawText);

  const eligible = (options.websiteOnly ? entries.filter((e) => e.website) : entries).slice(
    0,
    options.limit ?? Number.MAX_SAFE_INTEGER,
  );

  const summary: UmaImportSummary = {
    parsed: entries.length,
    eligible: eligible.length,
    created: 0,
    merged: 0,
    skipped: 0,
    withWebsite: entries.filter((e) => e.website).length,
    needsContactRepair: entries.filter((e) => e.unreadableEmails.length > 0).length,
    examples: [],
  };

  for (const entry of eligible) {
    const dKey = domainKey(entry.website);
    const nKey = nameKey(entry.name);
    if (!nKey) {
      summary.skipped += 1;
      continue;
    }

    /**
     * The name decides whether this is the same company. A shared domain does
     * not.
     *
     * Matching on domain alone looked reasonable and silently lost 150 real
     * companies from the first production import: group members publish one
     * corporate site, so ATX TECHNOLOGY and BAVIMA STEEL both list
     * bavimasteel.com, and FRIENDSHIP and FRIENDSHIP CONTAINER both list
     * friendship.co.ke. The directory lists them separately, with their own
     * contacts, telephone numbers and addresses, because they are separate
     * businesses — each worth approaching on its own.
     *
     * A domain match with a different name is therefore recorded as a related
     * organization for a human to look at, not merged away. Losing a prospect
     * is invisible; a near-duplicate sitting in the list is not.
     */
    const existing = await db.organization.findFirst({
      where: { deletedAt: null, nameKey: nKey },
    });

    const domainSibling =
      !existing && dKey
        ? await db.organization.findFirst({
            where: { deletedAt: null, domainKey: dKey },
            select: { legalName: true },
          })
        : null;

    const provenance =
      `${edition}, page ${entry.page}. Source: ${SOURCE_URL}.` +
      (entry.unreadableEmails.length
        ? ` One or more email addresses could not be read cleanly from the source and were not imported: ${entry.unreadableEmails.join(', ')}. Confirm them before any outreach.`
        : '') +
      (entry.unreadableWebsite ? ` Website in source was unreadable: ${entry.unreadableWebsite}.` : '');

    if (options.dryRun) {
      summary[existing ? 'merged' : 'created'] += 1;
      if (summary.examples.length < 10) {
        summary.examples.push({
          name: entry.name,
          website: entry.website,
          status: existing ? 'would merge' : 'would create',
        });
      }
      continue;
    }

    const notes = [
      provenance,
      domainSibling
        ? `Shares the website ${entry.website} with "${domainSibling.legalName}", already recorded. The directory lists them separately; confirm whether they are one business before contacting both.`
        : '',
      entry.productsServices ? `Products/services (as published): ${entry.productsServices}` : '',
      entry.brands ? `Brands: ${entry.brands}` : '',
      entry.address ? `Address: ${entry.address}` : '',
      entry.poBox ? `P.O. Box: ${entry.poBox}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const org = existing
      ? await db.organization.update({
          where: { id: existing.id },
          data: {
            website: existing.website ?? entry.website,
            domainKey: existing.domainKey ?? dKey,
            industry: existing.industry ?? 'Manufacturing',
            notes: existing.notes ? `${existing.notes}\n\n${provenance}` : notes,
          },
        })
      : await db.organization.create({
          data: {
            legalName: entry.name,
            nameKey: nKey,
            website: entry.website,
            domainKey: dKey,
            industry: 'Manufacturing',
            country: 'Uganda',
            city: null,
            sector: 'standard',
            stage: 'new',
            source: 'import',
            sourceUrl: SOURCE_URL,
            ownerId: options.ownerId ?? null,
            isDemoData: false,
            tagsJson: JSON.stringify(['uma-directory', 'manufacturing']),
            notes,
          },
        });

    if (existing) summary.merged += 1;
    else summary.created += 1;

    // Contacts. Imported from a printed directory, therefore unverified.
    const contactName = entry.contactPerson?.replace(/\s+/g, ' ').trim();
    const primaryEmail = entry.emails[0] ?? null;
    const primaryPhone = entry.phones[0] ?? null;

    if (contactName || primaryEmail || primaryPhone) {
      const eKey = emailKey(primaryEmail);
      const pKey = phoneKey(primaryPhone);
      const duplicate = await db.contact.findFirst({
        where: {
          organizationId: org.id,
          deletedAt: null,
          OR: [
            ...(eKey ? [{ emailKey: eKey }] : []),
            ...(pKey ? [{ phoneKey: pKey }] : []),
            ...(contactName ? [{ name: contactName }] : []),
          ],
        },
      });

      if (!duplicate) {
        await db.contact.create({
          data: {
            organizationId: org.id,
            name: contactName || '(name not published)',
            role: entry.designation?.replace(/\s+/g, ' ').trim() || null,
            email: primaryEmail,
            emailKey: eKey,
            phone: primaryPhone,
            phoneKey: pKey,
            whatsapp: entry.whatsapp,
            sourceUrl: SOURCE_URL,
            sourceNote: `${edition}, page ${entry.page}`,
            // A printed directory records what was true at publication.
            verificationStatus: 'unverified',
            isPrimary: true,
          },
        });
      }
    }

    if (summary.examples.length < 10) {
      summary.examples.push({
        name: entry.name,
        website: entry.website,
        status: existing ? 'merged' : 'created',
      });
    }
  }

  if (!options.dryRun) {
    await logActivity({
      actorId: options.actorId,
      action: 'lead.import_uma',
      entityType: 'import_batch',
      entityId: edition,
      newValue: {
        parsed: summary.parsed,
        created: summary.created,
        merged: summary.merged,
        withWebsite: summary.withWebsite,
      },
      reason: `Imported from ${edition}.`,
    });
  }

  return summary;
}
