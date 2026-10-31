import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const outputFile = join(process.cwd(), 'supabase', 'all-migrations-bundle.sql');

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

let bundle = `-- AutoPW3 Consolidated Database Migrations\n-- Generated for easy single-query execution in Supabase Dashboard SQL Editor\n\n`;

for (const file of files) {
  bundle += `-- ==========================================\n`;
  bundle += `-- Migration: ${file}\n`;
  bundle += `-- ==========================================\n\n`;
  bundle += readFileSync(join(migrationsDir, file), 'utf8');
  bundle += `\n\n`;
}

writeFileSync(outputFile, bundle, 'utf8');
console.log(`Successfully bundled ${files.length} migrations to ${outputFile}`);
