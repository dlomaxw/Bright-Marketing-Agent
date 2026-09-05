import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword, passwordProblems } from '../src/server/auth/password';
import { ROLES, ROLE_LABELS, type Role } from '../src/lib/enums';

/**
 * Creates or updates a real user account.
 *
 *   npx tsx scripts/create-user.ts --email you@example.com --name "Your Name" --role admin
 *   npx tsx scripts/create-user.ts --email you@example.com --password '...' --senior
 *
 * Prompts are avoided so this can run in a deployment step. If `--password` is
 * omitted a strong one is generated and printed once.
 */

const db = new PrismaClient();
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const symbols = '!@#$%^&*';
  const { randomInt } = require('node:crypto') as typeof import('node:crypto');
  let out = '';
  for (let i = 0; i < 18; i++) out += alphabet[randomInt(alphabet.length)];
  return `${out}${symbols[randomInt(symbols.length)]}${randomInt(10)}`;
}

async function main() {
  const email = opt('email')?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('--email is required and must be a full address.');
  }

  const role = (opt('role') ?? 'admin') as Role;
  if (!ROLES.includes(role)) {
    throw new Error(`--role must be one of: ${ROLES.join(', ')}`);
  }

  const name = opt('name') ?? email.split('@')[0]!.replace(/[._-]/g, ' ');
  const password = opt('password') ?? generatePassword();
  const generated = !opt('password');

  const problems = passwordProblems(password);
  if (problems.length > 0) {
    throw new Error(`The password does not meet policy:\n  - ${problems.join('\n  - ')}`);
  }

  // The role row must exist before a user can reference it.
  await db.role.upsert({
    where: { code: role },
    create: { code: role, name: ROLE_LABELS[role], description: ROLE_LABELS[role] },
    update: {},
  });

  const passwordHash = await hashPassword(password);
  const existing = await db.user.findUnique({ where: { email } });

  const user = await db.user.upsert({
    where: { email },
    create: {
      email,
      name,
      passwordHash,
      roleCode: role,
      seniorApprover: flag('senior') || role === 'admin',
      signature: `${name}\nBright Thoughts Services`,
      status: 'active',
    },
    update: {
      name,
      passwordHash,
      roleCode: role,
      seniorApprover: flag('senior') || role === 'admin',
      status: 'active',
      deletedAt: null,
    },
  });

  // Any existing sessions belong to the old password.
  const { count } = await db.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  console.log(`\n${existing ? 'Updated' : 'Created'} user`);
  console.log(`  name:   ${user.name}`);
  console.log(`  email:  ${user.email}`);
  console.log(`  role:   ${ROLE_LABELS[role]}`);
  console.log(`  senior approver: ${user.seniorApprover ? 'yes' : 'no'}`);
  if (count > 0) console.log(`  revoked ${count} existing session(s)`);

  if (generated) {
    console.log(`\n  GENERATED PASSWORD: ${password}`);
    console.log('  Store it in a password manager now — it is not shown again.');
  } else {
    console.log('\n  Password set from --password.');
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : err}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
