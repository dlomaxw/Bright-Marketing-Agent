import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { apiHandler, body, conflict, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { domainKey, nameKey, normalizeUrl } from '@/lib/normalize';
import { findDuplicates } from '@/server/leads/dedupe';
import { logActivity } from '@/server/activity';
import { zPipelineStage, zPlatform, zSector } from '@/lib/enums';

const createSchema = z.object({
  legalName: z.string().min(2, 'Enter the organization name.').max(200),
  brandName: z.string().max(200).optional().nullable(),
  industry: z.string().max(120).optional().nullable(),
  country: z.string().max(80).default('Uganda'),
  city: z.string().max(120).optional().nullable(),
  website: z.string().max(500).optional().nullable(),
  sector: zSector.default('standard'),
  stage: zPipelineStage.default('new'),
  ownerId: z.string().optional().nullable(),
  tags: z.array(z.string().max(40)).max(20).default([]),
  notes: z.string().max(8000).optional().nullable(),
  source: z.enum(['manual', 'import', 'referral', 'research']).default('manual'),
  sourceUrl: z.string().max(500).optional().nullable(),
  opportunityValue: z.number().nonnegative().optional().nullable(),
  currency: z.enum(['UGX', 'USD']).default('UGX'),
  profiles: z
    .array(z.object({ platform: zPlatform, url: z.string().min(4) }))
    .max(10)
    .default([]),
  contacts: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        role: z.string().max(120).optional().nullable(),
        email: z.string().max(200).optional().nullable(),
        phone: z.string().max(60).optional().nullable(),
        whatsapp: z.string().max(60).optional().nullable(),
        sourceUrl: z.string().max(500).optional().nullable(),
      }),
    )
    .max(10)
    .default([]),
  /** Set true after the user has seen and accepted the duplicate warning. */
  allowDuplicate: z.boolean().default(false),
});

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requirePermission('org.create');
  const input = await body(req, createSchema);

  const website = input.website ? normalizeUrl(input.website) : null;
  if (input.website && !website) {
    throw conflict(`"${input.website}" is not a usable web address.`);
  }

  const duplicates = await findDuplicates({
    legalName: input.legalName,
    website,
    emails: input.contacts.map((c) => c.email),
    phones: input.contacts.map((c) => c.phone),
  });

  if (duplicates.length > 0 && !input.allowDuplicate) {
    return ok(
      {
        error: 'This looks like an existing record.',
        duplicates,
        hint: 'Open the existing record, or resubmit with allowDuplicate to create a separate one.',
      },
      409,
    );
  }

  const { emailKey, phoneKey } = await import('@/lib/normalize');

  const org = await db.organization.create({
    data: {
      legalName: input.legalName,
      brandName: input.brandName || null,
      industry: input.industry || null,
      country: input.country,
      city: input.city || null,
      website,
      domainKey: domainKey(website),
      nameKey: nameKey(input.legalName),
      sector: input.sector,
      stage: input.stage,
      ownerId: input.ownerId || user.id,
      tagsJson: JSON.stringify(input.tags),
      notes: input.notes || null,
      source: input.source,
      sourceUrl: input.sourceUrl || null,
      opportunityValue: input.opportunityValue ?? null,
      currency: input.currency,
      profiles: {
        create: input.profiles.flatMap((p) => {
          const url = normalizeUrl(p.url);
          return url ? [{ platform: p.platform, url }] : [];
        }),
      },
      contacts: {
        create: input.contacts.map((c) => ({
          name: c.name,
          role: c.role || null,
          email: c.email || null,
          emailKey: emailKey(c.email),
          phone: c.phone || null,
          phoneKey: phoneKey(c.phone),
          whatsapp: c.whatsapp || null,
          sourceUrl: c.sourceUrl || null,
          verificationStatus: 'unverified',
        })),
      },
    },
  });

  await logActivity({
    organizationId: org.id,
    actorId: user.id,
    action: 'org.created',
    entityType: 'organization',
    entityId: org.id,
    newValue: { legalName: org.legalName, website: org.website },
  });

  return ok({ id: org.id }, 201);
});
