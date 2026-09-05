import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import {
  domainKey,
  emailKey,
  isValidUrl,
  nameKey,
  normalizeUrl,
  phoneKey,
} from '@/lib/normalize';
import { parseCsvTable, suggestMapping } from '@/lib/csv';
import { findDuplicates } from './dedupe';
import { logActivity } from '@/server/activity';
import type { Platform } from '@/lib/enums';

/**
 * Lead import.
 *
 * Two properties matter more than throughput here:
 *  - malformed rows are rejected with a reason, never silently coerced;
 *  - an imported "Status / Issue" becomes a finding marked
 *    `requiresReverification`, never a client-visible claim. Imported evidence
 *    is historical by definition (documentation 21, freshness policy).
 */

export interface ImportRowResult {
  rowNumber: number;
  status: 'created' | 'merged' | 'skipped' | 'error';
  organizationId?: string;
  organizationName: string;
  messages: string[];
}

export interface ImportSummary {
  batchId: string;
  total: number;
  created: number;
  merged: number;
  skipped: number;
  errors: number;
  results: ImportRowResult[];
}

export interface ImportOptions {
  /** Column mapping: field -> CSV header. Omitted fields are auto-suggested. */
  mapping?: Record<string, string | null>;
  /** When false, duplicate rows are skipped instead of merged into the existing record. */
  mergeDuplicates?: boolean;
  ownerId?: string | null;
  actorId: string;
  markAsDemoData?: boolean;
  /** Validate and report without writing anything. */
  dryRun?: boolean;
}

const SOCIAL_FIELDS: [string, Platform][] = [
  ['facebook', 'facebook'],
  ['instagram', 'instagram'],
  ['linkedin', 'linkedin'],
  ['x', 'x'],
  ['tiktok', 'tiktok'],
  ['youtube', 'youtube'],
  ['googleBusiness', 'google_business'],
];

export async function importCsv(csv: string, options: ImportOptions): Promise<ImportSummary> {
  const table = parseCsvTable(csv);
  const mapping = { ...suggestMapping(table.headers), ...(options.mapping ?? {}) };
  const batchId = randomUUID();

  const summary: ImportSummary = {
    batchId,
    total: table.rows.length,
    created: 0,
    merged: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  const get = (row: Record<string, string>, field: string): string => {
    const header = mapping[field];
    if (!header) return '';
    return (row[header] ?? '').trim();
  };

  // Within-file duplicates matter as much as against-database ones.
  const seenInFile = new Map<string, number>();

  for (const [index, row] of table.rows.entries()) {
    const rowNumber = index + 2; // +1 for the header, +1 for 1-based display
    const messages: string[] = [];

    const legalName = get(row, 'legalName');
    if (!legalName) {
      summary.errors += 1;
      summary.results.push({
        rowNumber,
        status: 'error',
        organizationName: '(blank)',
        messages: ['No organization name in the mapped column.'],
      });
      continue;
    }

    const rawWebsite = get(row, 'website');
    let website: string | null = null;
    if (rawWebsite) {
      if (isValidUrl(rawWebsite)) {
        website = normalizeUrl(rawWebsite);
      } else {
        messages.push(`The website value "${rawWebsite}" is not a usable URL and was not imported.`);
      }
    }

    const contactEmail = get(row, 'contactEmail');
    const contactPhone = get(row, 'contactPhone');
    if (contactEmail && !emailKey(contactEmail)) {
      messages.push(`The email "${contactEmail}" is not a valid address and was not imported.`);
    }

    const dedupeKey = domainKey(website) ?? nameKey(legalName);
    const firstSeen = seenInFile.get(dedupeKey);
    if (firstSeen) {
      summary.skipped += 1;
      summary.results.push({
        rowNumber,
        status: 'skipped',
        organizationName: legalName,
        messages: [`Duplicate of row ${firstSeen} in this file.`],
      });
      continue;
    }
    seenInFile.set(dedupeKey, rowNumber);

    const duplicates = await findDuplicates({
      legalName,
      website,
      emails: [contactEmail],
      phones: [contactPhone],
    });

    if (duplicates.length > 0 && !options.mergeDuplicates) {
      summary.skipped += 1;
      summary.results.push({
        rowNumber,
        status: 'skipped',
        organizationId: duplicates[0]!.organizationId,
        organizationName: legalName,
        messages: [
          `Matches the existing record "${duplicates[0]!.organizationName}" on ${[...new Set(duplicates.map((d) => d.matchedOn))].join(' and ')}.`,
          ...messages,
        ],
      });
      continue;
    }

    if (options.dryRun) {
      summary[duplicates.length > 0 ? 'merged' : 'created'] += 1;
      summary.results.push({
        rowNumber,
        status: duplicates.length > 0 ? 'merged' : 'created',
        organizationName: legalName,
        messages: [
          duplicates.length > 0
            ? `Would merge into "${duplicates[0]!.organizationName}".`
            : 'Would create a new organization.',
          ...messages,
        ],
      });
      continue;
    }

    try {
      const existingId = duplicates[0]?.organizationId;
      const scoreRaw = Number(get(row, 'importedScore').replace(/[^\d.]/g, ''));
      const importedScore = Number.isFinite(scoreRaw) && scoreRaw > 0 ? Math.round(scoreRaw) : null;
      const salesOffer = get(row, 'salesOffer');
      const tags = get(row, 'tags')
        .split(/[;,|]/)
        .map((t) => t.trim())
        .filter(Boolean);

      const data = {
        legalName,
        brandName: get(row, 'brandName') || null,
        industry: get(row, 'industry') || null,
        country: get(row, 'country') || 'Uganda',
        city: get(row, 'city') || null,
        website,
        domainKey: domainKey(website),
        nameKey: nameKey(legalName),
        notes: get(row, 'notes') || null,
        tagsJson: JSON.stringify(tags),
        source: 'import' as const,
        sourceUrl: get(row, 'sourceUrl') || null,
        ownerId: options.ownerId ?? null,
        importedScore,
        importBatchId: batchId,
        isDemoData: options.markAsDemoData ?? false,
        suggestedServiceCodes: JSON.stringify(salesOffer ? [salesOffer] : []),
      };

      const org = existingId
        ? await db.organization.update({
            where: { id: existingId },
            // Merging never overwrites a populated field with an imported blank.
            data: Object.fromEntries(
              Object.entries(data).filter(([, v]) => v !== null && v !== ''),
            ),
          })
        : await db.organization.create({ data });

      // Contact
      const contactName = get(row, 'contactName');
      if (contactName || contactEmail || contactPhone) {
        const ek = emailKey(contactEmail);
        const pk = phoneKey(contactPhone);
        const already = await db.contact.findFirst({
          where: {
            organizationId: org.id,
            deletedAt: null,
            OR: [
              ...(ek ? [{ emailKey: ek }] : []),
              ...(pk ? [{ phoneKey: pk }] : []),
              ...(contactName ? [{ name: contactName }] : []),
            ],
          },
        });
        if (!already) {
          await db.contact.create({
            data: {
              organizationId: org.id,
              name: contactName || '(name not recorded)',
              role: get(row, 'contactRole') || null,
              email: ek,
              emailKey: ek,
              phone: contactPhone || null,
              phoneKey: pk,
              whatsapp: get(row, 'whatsapp') || null,
              sourceUrl: get(row, 'sourceUrl') || null,
              sourceNote: `Imported from ${batchId.slice(0, 8)}`,
              // Imported contacts are never trusted without a human check.
              verificationStatus: 'unverified',
            },
          });
        } else {
          messages.push('A matching contact already existed and was left unchanged.');
        }
      }

      // Platform profiles
      for (const [field, platform] of SOCIAL_FIELDS) {
        const value = get(row, field);
        if (!value) continue;
        const url = normalizeUrl(value);
        if (!url) {
          messages.push(`The ${platform} value "${value}" is not a usable URL.`);
          continue;
        }
        await db.platformProfile.upsert({
          where: { organizationId_platform_url: { organizationId: org.id, platform, url } },
          create: { organizationId: org.id, platform, url },
          update: {},
        });
      }

      // Imported legacy issue -> a finding that can never be shown to a client
      // until it has been re-observed.
      const issue = get(row, 'issue');
      if (issue) {
        const reference = `BTS-I-${batchId.slice(0, 6)}-${String(rowNumber).padStart(4, '0')}`;
        const exists = await db.finding.findUnique({ where: { reference } });
        if (!exists) {
          await db.finding.create({
            data: {
              reference,
              organizationId: org.id,
              checkCode: 'imported.legacy',
              category: 'content',
              severity: 'medium',
              confidence: 'low',
              observation_text: issue,
              businessImpact:
                'Imported from a previous review. The business impact has not been re-assessed.',
              recommendation:
                'Re-run the audit to confirm whether this observation still applies before using it with the client.',
              recommendedServiceCodes: JSON.stringify(salesOffer ? [salesOffer] : []),
              evidenceUrl: get(row, 'sourceUrl') || website,
              observedAt: new Date(),
              verificationStatus: 'needs_review',
              clientVisible: false,
              source: 'imported',
              requiresReverification: true,
              analystNote: 'Requires re-verification - imported from the reference dataset.',
            },
          });
          messages.push('The imported status was recorded as a finding requiring re-verification.');
        }
      }

      if (existingId) summary.merged += 1;
      else summary.created += 1;

      summary.results.push({
        rowNumber,
        status: existingId ? 'merged' : 'created',
        organizationId: org.id,
        organizationName: legalName,
        messages,
      });
    } catch (err) {
      summary.errors += 1;
      summary.results.push({
        rowNumber,
        status: 'error',
        organizationName: legalName,
        messages: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  if (!options.dryRun) {
    await logActivity({
      actorId: options.actorId,
      action: 'lead.import',
      entityType: 'import_batch',
      entityId: batchId,
      newValue: {
        total: summary.total,
        created: summary.created,
        merged: summary.merged,
        skipped: summary.skipped,
        errors: summary.errors,
      },
    });
  }

  return summary;
}
