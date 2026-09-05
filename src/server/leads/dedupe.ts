import { db } from '@/lib/db';
import { domainKey, emailKey, nameKey, phoneKey } from '@/lib/normalize';

export interface DuplicateMatch {
  organizationId: string;
  organizationName: string;
  matchedOn: 'domain' | 'name' | 'email' | 'phone';
  value: string;
  contactId?: string;
}

/**
 * Duplicate detection across all four identifiers named in the brief.
 * Returns every match rather than the first, so the UI can explain *why* a
 * record looks like a duplicate.
 */
export async function findDuplicates(input: {
  legalName?: string | null;
  website?: string | null;
  emails?: (string | null | undefined)[];
  phones?: (string | null | undefined)[];
  excludeOrganizationId?: string;
}): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];
  const exclude = input.excludeOrganizationId;

  const dk = domainKey(input.website);
  if (dk) {
    const rows = await db.organization.findMany({
      where: { domainKey: dk, deletedAt: null, ...(exclude ? { id: { not: exclude } } : {}) },
      select: { id: true, legalName: true },
    });
    for (const r of rows) {
      matches.push({
        organizationId: r.id,
        organizationName: r.legalName,
        matchedOn: 'domain',
        value: dk,
      });
    }
  }

  if (input.legalName) {
    const nk = nameKey(input.legalName);
    if (nk.length >= 3) {
      const rows = await db.organization.findMany({
        where: { nameKey: nk, deletedAt: null, ...(exclude ? { id: { not: exclude } } : {}) },
        select: { id: true, legalName: true },
      });
      for (const r of rows) {
        matches.push({
          organizationId: r.id,
          organizationName: r.legalName,
          matchedOn: 'name',
          value: input.legalName,
        });
      }
    }
  }

  const emails = (input.emails ?? []).map(emailKey).filter((v): v is string => !!v);
  if (emails.length > 0) {
    const rows = await db.contact.findMany({
      where: {
        emailKey: { in: emails },
        deletedAt: null,
        ...(exclude ? { organizationId: { not: exclude } } : {}),
      },
      select: { id: true, emailKey: true, organizationId: true, organization: { select: { legalName: true } } },
    });
    for (const r of rows) {
      matches.push({
        organizationId: r.organizationId,
        organizationName: r.organization.legalName,
        matchedOn: 'email',
        value: r.emailKey ?? '',
        contactId: r.id,
      });
    }
  }

  const phones = (input.phones ?? []).map((p) => phoneKey(p)).filter((v): v is string => !!v);
  if (phones.length > 0) {
    const rows = await db.contact.findMany({
      where: {
        phoneKey: { in: phones },
        deletedAt: null,
        ...(exclude ? { organizationId: { not: exclude } } : {}),
      },
      select: { id: true, phoneKey: true, organizationId: true, organization: { select: { legalName: true } } },
    });
    for (const r of rows) {
      matches.push({
        organizationId: r.organizationId,
        organizationName: r.organization.legalName,
        matchedOn: 'phone',
        value: r.phoneKey ?? '',
        contactId: r.id,
      });
    }
  }

  // De-duplicate the duplicate list itself.
  const seen = new Set<string>();
  return matches.filter((m) => {
    const key = `${m.organizationId}:${m.matchedOn}:${m.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
