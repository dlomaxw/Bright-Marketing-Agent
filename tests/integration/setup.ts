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
 */

const ROOT = path.resolve(__dirname, '../..');
const TEST_DB = path.join(ROOT, 'prisma', 'test.db');

export async function setup(): Promise<void> {
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
  for (const suffix of ['', '-journal']) {
    const file = `${TEST_DB}${suffix}`;
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // Windows sometimes holds the handle briefly; a stale test db is harmless.
    }
  }
}
