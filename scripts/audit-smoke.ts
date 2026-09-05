import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { domainKey, nameKey } from '../src/lib/normalize';
import { createAuditRun, drainQueue } from '../src/server/audit/runner';
import { WEB_CHECK_GROUPS } from '../src/lib/enums';
import { fixtureUrl } from '../fixtures/server';

/**
 * End-to-end check of the audit engine against the local fixture sites.
 *
 *   npm run fixtures              (terminal 1)
 *   npx tsx scripts/audit-smoke.ts
 *
 * Assertions are on specific check codes rather than counts, because what
 * matters is that the engine reports the right thing for the right reason.
 */

const db = new PrismaClient();

interface Expectation {
  slug: string;
  /** Check codes that MUST have produced a finding. */
  expectFindings: string[];
  /** Check codes that must NOT have produced a finding. */
  forbidFindings?: string[];
  /** Check codes that must be recorded as `unverifiable`. */
  expectUnverifiable?: string[];
  offline?: boolean;
}

const CASES: Expectation[] = [
  {
    slug: 'healthy',
    expectFindings: [],
    forbidFindings: [
      'wp.default_pages', 'wp.hello_world', 'content.lorem', 'content.demo',
      'page.thin', 'title.missing', 'meta.description_missing', 'heading.h1_missing',
      'viewport.missing', 'form.present', 'contact.phone_visible', 'tel.link',
      'whatsapp.link', 'analytics.tag_present', 'privacy.page', 'terms.page',
      'dir.index', 'page.holding', 'link.internal_broken', 'schema.missing',
    ],
  },
  { slug: 'directory-index', expectFindings: ['dir.index'] },
  { slug: 'coming-soon', expectFindings: ['page.holding'] },
  {
    slug: 'wordpress-residue',
    expectFindings: ['wp.default_pages', 'wp.hello_world', 'wp.readme'],
  },
  {
    slug: 'template-residue',
    expectFindings: ['content.lorem', 'content.demo', 'content.placeholder_contact', 'title.missing', 'meta.description_missing'],
  },
  { slug: 'server-error', expectFindings: ['http.status'] },
  { slug: 'noindex', expectFindings: ['indexability.noindex'] },
  { slug: 'redirect-loop', expectFindings: ['redirect.loop'] },
  { slug: 'long-redirect', expectFindings: ['redirect.chain'] },
  {
    slug: 'robots-blocked',
    expectFindings: [],
    forbidFindings: ['http.status', 'page.holding', 'title.missing', 'dir.index'],
    expectUnverifiable: ['http.status'],
  },
  { slug: 'timeout', expectFindings: ['http.reachable'] },
  { slug: 'offline-host', expectFindings: ['http.reachable'], offline: true },
];

async function main() {
  const actor = await db.user.findFirst({ where: { roleCode: 'auditor' } });
  if (!actor) throw new Error('Run `npm run db:seed` first.');

  let failures = 0;
  const report: string[] = [];

  for (const testCase of CASES) {
    const url = testCase.offline ? 'http://localhost:4999/' : fixtureUrl(testCase.slug);
    const name = `Fixture ${testCase.slug}`;

    await db.organization.deleteMany({ where: { nameKey: nameKey(name) } });
    const org = await db.organization.create({
      data: {
        legalName: name,
        nameKey: nameKey(name),
        website: url,
        domainKey: domainKey(url),
        city: 'Kampala',
        industry: 'Fixture',
        isDemoData: true,
        source: 'research',
      },
    });

    const run = await createAuditRun({
      organizationId: org.id,
      groups: [...WEB_CHECK_GROUPS],
      requestedById: actor.id,
    });
    await drainQueue(50);

    const observations = await db.observation.findMany({ where: { auditRunId: run.id } });
    const findings = await db.finding.findMany({ where: { organizationId: org.id } });

    const findingCodes = new Set(findings.map((f) => f.checkCode));
    const unverifiableCodes = new Set(
      observations.filter((o) => o.outcome === 'unverifiable').map((o) => o.checkCode),
    );
    const counts = observations.reduce<Record<string, number>>((acc, o) => {
      acc[o.outcome] = (acc[o.outcome] ?? 0) + 1;
      return acc;
    }, {});

    const problems: string[] = [];

    for (const code of testCase.expectFindings) {
      if (!findingCodes.has(code)) problems.push(`expected a finding for "${code}" but none was produced`);
    }
    for (const code of testCase.forbidFindings ?? []) {
      if (findingCodes.has(code)) problems.push(`produced a finding for "${code}" which should not apply here`);
    }
    for (const code of testCase.expectUnverifiable ?? []) {
      if (!unverifiableCodes.has(code)) problems.push(`expected "${code}" to be recorded as unverifiable`);
    }

    // Invariants that must hold for every case, not just the interesting ones.
    for (const f of findings) {
      if (f.clientVisible) problems.push(`${f.reference} is client-visible before human verification`);
      if (!f.observedAt) problems.push(`${f.reference} has no observation timestamp`);
      if (!f.businessImpact || !f.recommendation) problems.push(`${f.reference} is missing impact or recommendation`);
    }
    // Nothing that could not be verified may have become a finding.
    for (const code of unverifiableCodes) {
      if (findingCodes.has(code)) {
        problems.push(`check "${code}" was unverifiable yet produced a finding`);
      }
    }

    const ok = problems.length === 0;
    if (!ok) failures += 1;

    report.push(
      `${ok ? 'PASS' : 'FAIL'}  ${testCase.slug.padEnd(18)} ` +
        `obs=${String(observations.length).padStart(3)} ` +
        `(issue=${counts.issue ?? 0} pass=${counts.pass ?? 0} unverifiable=${counts.unverifiable ?? 0} skipped=${counts.skipped ?? 0}) ` +
        `findings=${findings.length}`,
    );
    for (const p of problems) report.push(`        !! ${p}`);
    if (ok && findings.length > 0) {
      for (const f of findings.slice(0, 3)) {
        report.push(`        · [${f.severity}] ${f.checkCode}`);
      }
    }
  }

  console.log(report.join('\n'));
  console.log(
    `\n${failures === 0 ? `All ${CASES.length} fixture cases behaved correctly.` : `${failures} of ${CASES.length} cases failed.`}`,
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
