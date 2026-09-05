import fs from 'node:fs';
import path from 'node:path';
import { importCsv } from '../src/server/leads/import';
import { db } from '../src/lib/db';

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith('--'));

  if (!filePath) {
    console.error('Usage: npm run import -- <path-to-csv> [--dry-run] [--demo]');
    process.exit(1);
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`Error: File not found at ${absolutePath}`);
    process.exit(1);
  }

  const dryRun = args.includes('--dry-run');
  const markAsDemoData = args.includes('--demo');

  // Find admin user for actorId
  const adminUser = await db.user.findFirst({
    where: { roleCode: 'admin' },
  });

  if (!adminUser) {
    console.error('Error: System requires seeded admin user before import. Run `npm run db:seed`.');
    process.exit(1);
  }

  console.log(`Importing leads from ${absolutePath}...`);
  if (dryRun) console.log('[Dry Run Mode - No changes will be saved]');

  const csvContent = fs.readFileSync(absolutePath, 'utf8');

  const summary = await importCsv(csvContent, {
    actorId: adminUser.id,
    dryRun,
    markAsDemoData,
    mergeDuplicates: true,
  });

  console.log('\n--- Import Summary ---');
  console.log(`Batch ID: ${summary.batchId}`);
  console.log(`Total Rows: ${summary.total}`);
  console.log(`Created:    ${summary.created}`);
  console.log(`Merged:     ${summary.merged}`);
  console.log(`Skipped:    ${summary.skipped}`);
  console.log(`Errors:     ${summary.errors}`);

  if (summary.results.length > 0) {
    console.log('\n--- Sample Row Results ---');
    summary.results.slice(0, 10).forEach((r) => {
      console.log(`Row ${r.rowNumber} [${r.status.toUpperCase()}]: ${r.organizationName}`);
      r.messages.forEach((m) => console.log(`   └─ ${m}`));
    });
    if (summary.results.length > 10) {
      console.log(`... and ${summary.results.length - 10} more rows.`);
    }
  }

  process.exit(summary.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error during import:', err);
  process.exit(1);
});
