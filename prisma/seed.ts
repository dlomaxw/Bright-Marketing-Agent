import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/server/auth/password';
import { domainKey, emailKey, nameKey, phoneKey } from '../src/lib/normalize';
import { SERVICE_MODULES } from './seed/services';
import { DEMO_ORGANIZATIONS } from './seed/demo-organizations';
import { ROLE_LABELS, ROLES } from '../src/lib/enums';

const db = new PrismaClient();

/**
 * Idempotent seed. Safe to run repeatedly: everything upserts, and demo
 * organizations are keyed on their (reserved) domain.
 */

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: 'Manages users, templates, scoring, integrations, services, pricing and retention.',
  auditor: 'Creates leads, runs audits, verifies evidence and prepares reports.',
  sales: 'Edits proposals, emails, follow-ups and pipeline stages.',
  approver: 'Approves or rejects reports, proposals and outbound emails.',
  viewer: 'Read-only access to dashboards and exports.',
};

const DEV_PASSWORD = process.env.SEED_PASSWORD ?? 'BrightScope2026!Dev';

const USERS = [
  { name: 'Aisha Nakimuli', email: 'admin@brightthoughts.example', role: 'admin', senior: true },
  { name: 'Daniel Okiror', email: 'auditor@brightthoughts.example', role: 'auditor', senior: false },
  { name: 'Sylvia Namara', email: 'sales@brightthoughts.example', role: 'sales', senior: false },
  { name: 'Moses Wandera', email: 'approver@brightthoughts.example', role: 'approver', senior: true },
  { name: 'Ruth Atim', email: 'viewer@brightthoughts.example', role: 'viewer', senior: false },
];

const EMAIL_TEMPLATES = [
  {
    key: 'first_contact',
    name: 'First contact — single observation',
    subject: "A quick observation about [ORGANIZATION]'s website",
    content: [
      'Hello [NAME],',
      '',
      "While reviewing [ORGANIZATION]'s public digital presence, we observed that [VERIFIED_OBSERVATION] at [EVIDENCE_URL].",
      '',
      'This may make it harder for visitors to [RELEVANT_IMPACT].',
      '',
      'Bright Thoughts Services has prepared a short, evidence-based audit outlining what we observed, the quick corrections available, and a practical improvement plan covering [RELEVANT_SERVICES].',
      '',
      'Would you be available for a 20-minute discussion next week?',
      '',
      'Kind regards,',
      '[SENDER]',
    ].join('\n'),
  },
  {
    key: 'follow_up_no_reply',
    name: 'Follow-up — no reply',
    subject: 'Following up on our note about [ORGANIZATION]',
    content: [
      'Hello [NAME],',
      '',
      'I wrote recently about an observation on [ORGANIZATION]\'s website. I appreciate that this may not be a priority at the moment.',
      '',
      'If it would be useful, I am glad to send the short audit for your own reference with no obligation.',
      '',
      'Kind regards,',
      '[SENDER]',
    ].join('\n'),
  },
];

async function main() {
  console.log('Seeding BrightScope…');

  for (const code of ROLES) {
    await db.role.upsert({
      where: { code },
      create: { code, name: ROLE_LABELS[code], description: ROLE_DESCRIPTIONS[code] ?? '' },
      update: { name: ROLE_LABELS[code], description: ROLE_DESCRIPTIONS[code] ?? '' },
    });
  }
  console.log(`  roles: ${ROLES.length}`);

  const passwordHash = await hashPassword(DEV_PASSWORD);
  for (const u of USERS) {
    await db.user.upsert({
      where: { email: u.email },
      create: {
        name: u.name,
        email: u.email,
        passwordHash,
        roleCode: u.role,
        seniorApprover: u.senior,
        signature: `${u.name}\nBright Thoughts Services`,
      },
      update: { name: u.name, roleCode: u.role, seniorApprover: u.senior },
    });
  }
  console.log(`  users: ${USERS.length}`);

  for (const s of SERVICE_MODULES) {
    await db.serviceModule.upsert({
      where: { code: s.code },
      create: {
        code: s.code,
        name: s.name,
        family: s.family,
        summary: s.summary,
        deliverablesJson: JSON.stringify(s.deliverables),
        defaultPhase: s.defaultPhase,
        triggerCategoriesJson: JSON.stringify(s.triggerCategories),
        triggerCheckCodesJson: JSON.stringify(s.triggerCheckCodes),
        sortOrder: s.sortOrder,
      },
      update: {
        name: s.name,
        summary: s.summary,
        deliverablesJson: JSON.stringify(s.deliverables),
        triggerCategoriesJson: JSON.stringify(s.triggerCategories),
        triggerCheckCodesJson: JSON.stringify(s.triggerCheckCodes),
      },
    });
  }
  console.log(`  service modules: ${SERVICE_MODULES.length} (no prices — an administrator sets the price book)`);

  for (const t of EMAIL_TEMPLATES) {
    await db.template.upsert({
      where: { type_key_version: { type: 'email_body', key: t.key, version: 1 } },
      create: { type: 'email_body', key: t.key, name: t.name, subject: t.subject, content: t.content },
      update: { name: t.name, subject: t.subject, content: t.content },
    });
  }
  console.log(`  templates: ${EMAIL_TEMPLATES.length}`);

  for (const code of [
    ['pagespeed', 'PageSpeed Insights'],
    ['google_places', 'Google Places / Business'],
    ['email_provider', 'Email provider'],
    ['meta', 'Meta (Facebook and Instagram)'],
    ['linkedin', 'LinkedIn'],
    ['youtube', 'YouTube'],
    ['storage', 'Object storage'],
  ] as const) {
    await db.integration.upsert({
      where: { code: code[0] },
      create: { code: code[0], name: code[1] },
      update: { name: code[1] },
    });
  }

  const admin = await db.user.findUnique({ where: { email: 'admin@brightthoughts.example' } });
  const auditor = await db.user.findUnique({ where: { email: 'auditor@brightthoughts.example' } });
  const sales = await db.user.findUnique({ where: { email: 'sales@brightthoughts.example' } });
  const owners = [auditor?.id, sales?.id, admin?.id].filter((v): v is string => !!v);

  const batchId = randomUUID();
  let created = 0;

  /**
   * Fictional demonstration organizations are OFF by default.
   *
   * The real dataset is the UMA Business Directory (`npm run import:uma`), and
   * mixing invented companies into a database of real prospects is how someone
   * ends up auditing — or contacting — a business that does not exist. Set
   * SEED_DEMO=true only when you deliberately want the demo path.
   */
  const seedDemo = process.env.SEED_DEMO === 'true';

  for (const [index, demo] of seedDemo ? DEMO_ORGANIZATIONS.entries() : []) {
    const dk = domainKey(demo.website);
    const existing = dk
      ? await db.organization.findFirst({ where: { domainKey: dk } })
      : await db.organization.findFirst({ where: { nameKey: nameKey(demo.legalName) } });
    if (existing) continue;

    const org = await db.organization.create({
      data: {
        legalName: demo.legalName,
        brandName: demo.brandName ?? null,
        industry: demo.industry,
        country: 'Uganda',
        city: demo.city,
        website: demo.website,
        domainKey: dk,
        nameKey: nameKey(demo.legalName),
        sector: demo.sector ?? 'standard',
        stage: demo.stage ?? 'new',
        ownerId: owners[index % owners.length] ?? null,
        source: 'import',
        importBatchId: batchId,
        importedScore: demo.importedScore,
        isDemoData: true,
        tagsJson: JSON.stringify(['demo-data', 'reference-dataset']),
        suggestedServiceCodes: JSON.stringify([demo.salesOffer]),
        notes:
          'Seeded demonstration record. The supplied Uganda 100 dataset was not available; this is fictional data on a reserved domain. See docs/ASSUMPTIONS.md.',
        contacts: demo.contact
          ? {
              create: {
                name: demo.contact.name,
                role: demo.contact.role,
                email: demo.contact.email ?? null,
                emailKey: emailKey(demo.contact.email),
                phone: demo.contact.phone ?? null,
                phoneKey: phoneKey(demo.contact.phone),
                sourceUrl: demo.contact.sourceUrl ?? null,
                sourceNote: 'Seeded demonstration contact — not a real person.',
                verificationStatus: 'unverified',
                isPrimary: true,
              },
            }
          : undefined,
        profiles: demo.profiles?.length
          ? { create: demo.profiles.map((p) => ({ platform: p.platform, url: p.url })) }
          : undefined,
      },
    });

    // The legacy observation becomes a finding that can never reach a client
    // until it has been re-observed by an audit run.
    await db.finding.create({
      data: {
        reference: `BTS-I-DEMO-${String(index + 1).padStart(4, '0')}`,
        organizationId: org.id,
        checkCode: 'imported.legacy',
        category: 'content',
        severity: 'medium',
        confidence: 'low',
        observation_text: demo.issue,
        businessImpact: 'Imported from a previous review. The business impact has not been re-assessed.',
        recommendation:
          'Re-run the audit to confirm whether this observation still applies before using it with the client.',
        recommendedServiceCodes: JSON.stringify([demo.salesOffer]),
        evidenceUrl: demo.website,
        observedAt: new Date(),
        verificationStatus: 'needs_review',
        clientVisible: false,
        source: 'imported',
        requiresReverification: true,
        analystNote: 'Requires re-verification — imported reference observation.',
      },
    });

    created += 1;
  }

  console.log(
    seedDemo
      ? `  demo organizations: ${created} created (SEED_DEMO=true)`
      : '  demo organizations: skipped — real data only. Load prospects with `npm run import:uma`.',
  );

  console.log('\nSeed complete.\n');
  console.log('Sign in with any of these accounts:');
  for (const u of USERS) console.log(`  ${u.email.padEnd(38)} ${ROLE_LABELS[u.role as 'admin']}`);
  console.log(`\nPassword for every seeded account: ${DEV_PASSWORD}`);
  console.log('Change these before any deployment. See docs/ADMIN_GUIDE.md.\n');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
