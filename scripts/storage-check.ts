import 'dotenv/config';
import { env } from '../src/lib/env';
import {
  activeDriver,
  checkStorage,
  deleteObject,
  getObject,
  putObject,
  verifyObject,
} from '../src/server/storage/r2';

/**
 * Verifies object storage end to end: writes a small object, reads it back,
 * checks the hash matches, then deletes it.
 *
 *   npm run storage:check
 *   npm run storage:check -- --keep      # leave the test object in place
 */

const keep = process.argv.includes('--keep');

async function main() {
  console.log('\nBrightScope — object storage check');
  console.log('='.repeat(58));
  console.log(`\nDriver: ${activeDriver()}`);
  if (activeDriver() === 'r2') {
    console.log(`  endpoint: ${env.R2_S3_ENDPOINT}`);
    console.log(`  bucket:   ${env.R2_BUCKET}`);
  } else {
    console.log(`  path: ${env.STORAGE_LOCAL_PATH}`);
  }

  const health = await checkStorage();
  console.log(`\n${health.reachable ? 'PASS' : 'FAIL'}  ${health.message}`);
  if (!health.reachable) {
    process.exitCode = 1;
    return;
  }

  // Round trip: the properties that matter are that it comes back byte-identical
  // and that the recorded hash still verifies.
  console.log('\nRound trip');
  console.log('-'.repeat(58));

  const payload = Buffer.from(
    `BrightScope storage check\nwritten ${new Date().toISOString()}\n`,
    'utf8',
  );

  const stored = await putObject({
    data: payload,
    prefix: 'evidence',
    extension: '.txt',
    contentType: 'text/plain; charset=utf-8',
    metadata: { purpose: 'storage-check' },
  });
  console.log(`  PASS  wrote ${stored.bytes} bytes`);
  console.log(`        key    ${stored.key}`);
  console.log(`        sha256 ${stored.sha256.slice(0, 32)}…`);

  const readBack = await getObject(stored.key);
  if (!readBack) {
    console.log('  FAIL  could not read the object back');
    process.exitCode = 1;
    return;
  }
  console.log(
    readBack.equals(payload)
      ? '  PASS  read back byte-identical'
      : '  FAIL  content differs from what was written',
  );
  if (!readBack.equals(payload)) process.exitCode = 1;

  const verified = await verifyObject(stored.key, stored.sha256);
  console.log(verified ? '  PASS  hash verifies' : '  FAIL  hash does not verify');
  if (!verified) process.exitCode = 1;

  if (keep) {
    console.log(`\n  Left in place: ${stored.key}`);
  } else {
    await deleteObject(stored.key);
    const afterDelete = await getObject(stored.key);
    console.log(afterDelete === null ? '  PASS  deleted' : '  WARN  still readable after delete');
  }

  console.log(`\n${'='.repeat(58)}`);
  console.log(
    activeDriver() === 'local'
      ? 'Local storage is fine for development. Configure R2 before production —\n' +
          'evidence must outlive the machine that captured it.\n'
      : 'R2 is working. Evidence and generated documents will persist.\n',
  );
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
