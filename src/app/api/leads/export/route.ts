import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiHandler } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { toCsv } from '@/lib/csv';
import type { Prisma } from '@prisma/client';

export const GET = apiHandler(async (req: NextRequest) => {
  await requirePermission('org.read');

  /**
   * The export mirrors the filters on the leads screen. Exporting every
   * record while the user is looking at a filtered list is a quiet way to
   * hand someone the wrong spreadsheet.
   */
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.trim() ?? '';
  const stage = sp.get('stage') ?? '';
  const industry = sp.get('industry') ?? '';
  const owner = sp.get('owner') ?? '';
  const minScore = Number(sp.get('minScore') ?? '');

  const where: Prisma.OrganizationWhereInput = {
    deletedAt: null,
    ...(stage ? { stage } : {}),
    ...(industry ? { industry } : {}),
    ...(owner ? { ownerId: owner } : {}),
    ...(Number.isFinite(minScore) && minScore > 0 ? { opportunityScore: { gte: minScore } } : {}),
    ...(q
      ? {
          OR: [
            { legalName: { contains: q } },
            { brandName: { contains: q } },
            { website: { contains: q } },
            { city: { contains: q } },
            { industry: { contains: q } },
          ],
        }
      : {}),
  };

  const orgs = await db.organization.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      contacts: {
        where: { deletedAt: null },
        take: 1,
      },
    },
  });

  const exportRows = orgs.map((org) => {
    const primaryContact = org.contacts[0];
    const tags: string[] = org.tagsJson ? JSON.parse(org.tagsJson) : [];

    return {
      ID: org.id,
      'Legal Name': org.legalName,
      'Brand Name': org.brandName || '',
      Industry: org.industry || '',
      Website: org.website || '',
      City: org.city || '',
      Country: org.country,
      Stage: org.stage,
      Sector: org.sector,
      'Opportunity Score': org.opportunityScore ?? '',
      'Confidence Score': org.confidenceScore ?? '',
      'Risk Score': org.relationshipRisk ?? '',
      'Primary Contact Name': primaryContact?.name || '',
      'Primary Contact Email': primaryContact?.email || '',
      'Primary Contact Phone': primaryContact?.phone || '',
      Tags: tags.join('; '),
      'Created At': org.createdAt.toISOString(),
    };
  });

  const csvContent = toCsv(exportRows);

  return new Response(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="brightscope-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});
