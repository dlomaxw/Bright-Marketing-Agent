import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Provisions an isolated database for the integration tests.
 *
 * The behavioural tests exercise the send gates and the approval workflow
 * against real rows, because those are the paths that stop a wrong message
 * reaching a real business — asserting on the shape of the code is not enough.
 * They must never touch the development database, so this creates and destroys
 * a separate SQLite file.
 *
 * The committed Prisma provider is `postgresql`, because that is what the
 * deployment builds against and Prisma will not read the provider from the
 * environment (`provider = env(...)` fails validation). A generated client
 * refuses a datasource URL that does not match its provider, so these tests
 * switch the provider to sqlite, run, and switch it back — leaving the working
 * tree exactly as they found it, including when a test fails.
 */

const ROOT = path.resolve(__dirname, '../..');
const TEST_DB = path.join(ROOT, 'prisma', 'test.db');
const SCHEMA = path.join(ROOT, 'prisma', 'schema.prisma');

/** The provider as committed, restored on teardown. */
let originalSchema: string | null = null;

function useProvider(provider: 'sqlite' | 'postgresql'): void {
  const current = fs.readFileSync(SCHEMA, 'utf8');
  if (originalSchema === null) originalSchema = current;
  fs.writeFileSync(
    SCHEMA,
    current.replace(
      /(datasource\s+db\s*\{[\s\S]*?provider\s*=\s*")[^"]+(")/,
      `$1${provider}$2`,
    ),
    'utf8',
  );
  execFileSync('npx', ['prisma', 'generate'], {
    cwd: ROOT,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
}

export async function setup(): Promise<void> {
  useProvider('sqlite');

  for (const suffix of ['', '-journal']) {
    const file = `${TEST_DB}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
}

export async function teardown(): Promise<void> {
  // Restore the committed provider first, so an interrupted run cannot leave
  // sqlite in the working tree and quietly break the next deployment.
  if (originalSchema !== null) {
    fs.writeFileSync(SCHEMA, originalSchema, 'utf8');
    originalSchema = null;
    try {
      execFileSync('npx', ['prisma', 'generate'], {
        cwd: ROOT,
        stdio: 'pipe',
        shell: process.platform === 'win32',
      });
    } catch {
      // Regeneration is a convenience here; the schema file is what matters.
    }
  }

  for (const suffix of ['', '-journal']) {
    const file = `${TEST_DB}${suffix}`;
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // Windows sometimes holds the handle briefly; a stale test db is harmless.
    }
  }
}
