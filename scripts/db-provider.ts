import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const target = process.argv[2]?.toLowerCase();

if (!target || !['sqlite', 'postgresql', 'postgres'].includes(target)) {
  console.error('Usage: npm run db:use <sqlite|postgres>');
  process.exit(1);
}

const provider = target === 'sqlite' ? 'sqlite' : 'postgresql';
const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');

if (!fs.existsSync(schemaPath)) {
  console.error(`Error: Could not find schema file at ${schemaPath}`);
  process.exit(1);
}

let content = fs.readFileSync(schemaPath, 'utf8');

// Replace provider in datasource block
const updatedContent = content.replace(
  /(datasource\s+db\s*\{[\s\S]*?provider\s*=\s*")[^"]+(")/,
  `$1${provider}$2`
);

if (content === updatedContent) {
  console.log(`Database provider is already set to "${provider}".`);
} else {
  fs.writeFileSync(schemaPath, updatedContent, 'utf8');
  console.log(`Updated prisma/schema.prisma provider to "${provider}".`);
}

console.log('Running `prisma generate`...');
try {
  execSync('npx prisma generate', { stdio: 'inherit' });
  console.log('Prisma client generated successfully.');
} catch (err) {
  console.error('Failed to run `prisma generate`:', err);
  process.exit(1);
}
