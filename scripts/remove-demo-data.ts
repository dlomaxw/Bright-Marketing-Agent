import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Removes every seeded demonstration record, leaving only real prospects.
 *
 *   npx tsx scripts/remove-demo-data.ts --dry-run
 *   npx tsx scripts/remove-demo-data.ts
 *
 * Demonstration records are those flagged `isDemoData` — the fictional
 * organizations created by the seed and the fixture organizations created by
 * the audit smoke harness. Real prospects (the UMA directory import, anything
 * added by hand) are never touched.
 *
 * This is a hard delete rather than the usual soft delete: these rows were
 * never real, so there is no history worth preserving. Their `Activity` rows
 * survive with a null organization, because the activity log is append-only.
 */

const db = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const demo = await db.organization.findMany({
    where: { isDemoData: true },
    select: { id: true, legalName: true, website: true },
  });

  if (demo.length === 0) {
    console.log('No demonstration records found. Nothing to do.');
    return;
  }

  const ids = demo.map((d) => d.id);

  const [findings, contacts, runs, reports, proposals, emails, profiles, tasks] = await Promise.all([
    db.finding.count({ where: { organizationId: { in: ids } } }),
    db.contact.count({ where: { organizationId: { in: ids } } }),
    db.auditRun.count({ where: { organizationId: { in: ids } } }),
    db.report.count({ where: { organizationId: { in: ids } } }),
    db.proposal.count({ where: { organizationId: { in: ids } } }),
    db.emailDraft.count({ where: { organizationId: { in: ids } } }),
    db.platformProfile.count({ where: { organizationId: { in: ids } } }),
    db.task.count({ where: { organizationId: { in: ids } } }),
  ]);

  console.log(`Demonstration organizations: ${demo.length}`);
  console.log(`  findings ${findings} · contacts ${contacts} · audit runs ${runs}`);
  console.log(`  reports ${reports} · proposals ${proposals} · email drafts ${emails}`);
  console.log(`  platform profiles ${profiles} · tasks ${tasks}`);
  console.log('\nExamples:');
  for (const d of demo.slice(0, 8)) {
    console.log(`  ${d.legalName}${d.website ? ` — ${d.website}` : ''}`);
  }

  // Safety: refuse to run if anything flagged demo has somehow been approved
  // for client-facing use. That would mean the flag is not trustworthy and the
  // situation needs a human, not a bulk delete.
  const published = await db.finding.count({
    where: { organizationId: { in: ids }, clientVisible: true },
  });
  if (published > 0) {
    throw new Error(
      `${published} finding(s) on demonstration records are marked client-facing. ` +
        'Investigate before deleting — the demo flag may not be reliable.',
    );
  }

  if (dryRun) {
    console.log('\nDRY RUN — nothing was deleted.');
    return;
  }

  // Cascades handle contacts, profiles, audit runs, observations, evidence,
  // findings, reports, proposals, email drafts, tasks and meetings.
  const { count } = await db.organization.deleteMany({ where: { isDemoData: true } });

  const remaining = await db.organization.count({ where: { deletedAt: null } });
  const stillDemo = await db.organization.count({ where: { isDemoData: true } });

  console.log(`\nDeleted ${count} demonstration organization(s).`);
  console.log(`Remaining organizations: ${remaining} (demo flagged: ${stillDemo}).`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
