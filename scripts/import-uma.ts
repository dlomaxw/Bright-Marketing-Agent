import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { importUmaDirectory, parseUmaDirectory } from '../src/server/leads/uma-directory';

/**
 * Imports the Uganda Manufacturers Association Business Directory.
 *
 *   npx tsx scripts/import-uma.ts --dry-run
 *   npx tsx scripts/import-uma.ts --website-only --limit 100
 *   npx tsx scripts/import-uma.ts --pdf docs/UMA-Dirrectory-2026.pdf
 *
 * Accepts either the PDF (text is extracted on the fly) or a previously
 * extracted .txt file, which is much faster for repeated runs.
 */

const db = new PrismaClient();

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const DEFAULT_PDF = 'docs/UMA-Dirrectory-2026.pdf';
const CACHE = 'docs/uma-extracted.txt';

async function loadText(): Promise<string> {
  const explicitTxt = option('txt');
  if (explicitTxt) return fs.readFileSync(explicitTxt, 'utf8');

  const pdfPath = option('pdf') ?? DEFAULT_PDF;

  // Prefer the cached extraction — parsing a 272-page PDF takes a while.
  if (fs.existsSync(CACHE) && !flag('re-extract')) {
    const cacheAge = Date.now() - fs.statSync(CACHE).mtimeMs;
    const pdfAge = fs.existsSync(pdfPath) ? Date.now() - fs.statSync(pdfPath).mtimeMs : Infinity;
    if (cacheAge < pdfAge) {
      console.log(`Using cached extraction: ${CACHE}`);
      return fs.readFileSync(CACHE, 'utf8');
    }
  }

  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Neither ${CACHE} nor ${pdfPath} was found. Pass --pdf or --txt.`);
  }

  console.log(`Extracting text from ${pdfPath} …`);
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(pdfPath)) });
  const result = await parser.getText();
  await parser.destroy();

  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, result.text);
  console.log(`Cached extraction to ${CACHE}`);
  return result.text;
}

async function main() {
  const text = await loadText();

  if (flag('parse-only')) {
    const entries = parseUmaDirectory(text);
    console.log(`Parsed ${entries.length} entries.`);
    console.log(`  with a website:  ${entries.filter((e) => e.website).length}`);
    console.log(`  with an email:   ${entries.filter((e) => e.emails.length).length}`);
    console.log(`  with a phone:    ${entries.filter((e) => e.phones.length).length}`);
    console.log(`  with a contact:  ${entries.filter((e) => e.contactPerson).length}`);
    console.log(`  unreadable email in source: ${entries.filter((e) => e.unreadableEmails.length).length}`);
    console.log('\nFirst five with a website:');
    for (const e of entries.filter((x) => x.website).slice(0, 5)) {
      console.log(`\n  ${e.name}  (page ${e.page})`);
      console.log(`    website: ${e.website}`);
      console.log(`    email:   ${e.emails.join(', ') || '—'}`);
      console.log(`    phone:   ${e.phones.slice(0, 2).join(', ') || '—'}`);
      console.log(`    contact: ${e.contactPerson ?? '—'}${e.designation ? ` (${e.designation})` : ''}`);
      console.log(`    does:    ${(e.productsServices ?? '—').slice(0, 90)}`);
    }
    await db.$disconnect();
    return;
  }

  const actor =
    (await db.user.findFirst({ where: { roleCode: 'auditor', status: 'active' } })) ??
    (await db.user.findFirst({ where: { roleCode: 'admin', status: 'active' } }));

  if (!actor) throw new Error('No active auditor or admin user. Run `npm run db:seed` first.');

  const dryRun = flag('dry-run');
  const limitRaw = option('limit');

  console.log(
    `\n${dryRun ? 'DRY RUN — nothing will be written' : 'Importing'}` +
      `${flag('website-only') ? ' (entries with a website only)' : ''}` +
      `${limitRaw ? `, limit ${limitRaw}` : ''}\n`,
  );

  const summary = await importUmaDirectory(text, {
    actorId: actor.id,
    ownerId: actor.id,
    websiteOnly: flag('website-only'),
    limit: limitRaw ? Number(limitRaw) : undefined,
    dryRun,
  });

  console.log(`Parsed entries:        ${summary.parsed}`);
  console.log(`  publishing a website:${String(summary.withWebsite).padStart(6)}`);
  console.log(`Eligible for import:   ${summary.eligible}`);
  console.log(`  created:             ${summary.created}`);
  console.log(`  merged into existing:${String(summary.merged).padStart(6)}`);
  console.log(`  skipped:             ${summary.skipped}`);
  console.log(`Entries whose email could not be read cleanly: ${summary.needsContactRepair}`);
  console.log('\nExamples:');
  for (const ex of summary.examples) {
    console.log(`  [${ex.status}] ${ex.name}${ex.website ? ` — ${ex.website}` : ''}`);
  }

  if (!dryRun) {
    console.log(
      '\nImported contacts are UNVERIFIED, as a printed directory records what was true at publication.',
    );
    console.log('Run an audit against each website, verify the findings, then outreach can begin.');
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
