import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Marks directory-imported contacts as verified, on the owner's authority.
 *
 * The importer marks them unverified because a printed directory records what
 * was true at publication, not what is true today. Verification normally means
 * a person confirmed a specific address.
 *
 * That did not happen here, and the record says so. Each contact keeps a note
 * naming the basis — the published UMA Directory 2026 entry — and the account
 * that authorised it. `verifiedBy` therefore points at whoever took
 * responsibility for the decision, which is the honest answer, rather than
 * implying 1,545 individual checks that nobody performed.
 *
 *   npx tsx scripts/verify-imported-contacts.ts --actor md@shinebebright.com
 *   npx tsx scripts/verify-imported-contacts.ts --actor ... --dry-run
 */

const db = new PrismaClient();

async function main() {
  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const dryRun = process.argv.includes('--dry-run');
  const actorEmail = arg('actor');
  if (!actorEmail) throw new Error('--actor <email> is required: someone owns this decision.');

  const actor = await db.user.findUnique({
    where: { email: actorEmail.toLowerCase() },
    select: { id: true, name: true, status: true, deletedAt: true },
  });
  if (!actor || actor.status !== 'active' || actor.deletedAt) {
    throw new Error(`No active user ${actorEmail}.`);
  }

  const candidates = await db.contact.findMany({
    where: { deletedAt: null, verificationStatus: 'unverified', optedOut: false },
    select: { id: true, email: true, sourceNote: true },
  });

  const withEmail = candidates.filter((c) => c.email).length;
  console.log(`Unverified contacts:      ${candidates.length}`);
  console.log(`  of those, with an email: ${withEmail}`);
  console.log(`Authorised by:            ${actor.name} <${actorEmail}>`);

  if (dryRun) {
    console.log('\nDRY RUN — nothing written.');
    await db.$disconnect();
    return;
  }

  const verifiedAt = new Date();
  const basis =
    `Verified in bulk on ${verifiedAt.toISOString().slice(0, 10)} on the authority of ${actorEmail}, ` +
    'on the basis of the published UMA Directory 2026 entry. Not individually confirmed against the business.';

  let updated = 0;
  for (const contact of candidates) {
    await db.contact.update({
      where: { id: contact.id },
      data: {
        verificationStatus: 'verified',
        verifiedAt,
        verifiedBy: actor.id,
        sourceNote: [contact.sourceNote, basis].filter(Boolean).join('\n'),
      },
    });
    updated += 1;
    if (updated % 250 === 0) console.log(`  ${updated}…`);
  }

  await db.activity.create({
    data: {
      actorId: actor.id,
      action: 'contact.bulk_verified',
      entityType: 'contact',
      entityId: 'bulk',
      newValue: JSON.stringify({ verified: updated, withEmail, basis: 'UMA Directory 2026' }),
      reason: basis,
    },
  });

  console.log(`\nVerified ${updated} contact(s).`);
  console.log('Each carries a note recording the basis and who authorised it.');
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db.$disconnect();
  process.exit(1);
});
