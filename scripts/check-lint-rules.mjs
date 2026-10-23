// Proves the architectural lint rules in eslint.config.js actually fire.
// Usage: node scripts/check-lint-rules.mjs   (also runs as part of `npm run lint`)
// Safe to re-run: it lints in-memory snippets and writes nothing.
import { ESLint } from 'eslint';

const cases = [
  {
    name: 'domain must not import web',
    file: 'packages/domain/src/x.ts',
    code: "import { a } from '@autopw3/web';\nvoid a;\n",
    rule: 'no-restricted-imports',
  },
  {
    name: 'shared must not import domain',
    file: 'packages/shared/src/x.ts',
    code: "import { a } from '@autopw3/domain';\nvoid a;\n",
    rule: 'no-restricted-imports',
  },
  {
    name: 'web must not import worker package',
    file: 'apps/web/src/x.ts',
    code: "import { a } from '@autopw3/worker';\nvoid a;\n",
    rule: 'no-restricted-imports',
  },
  {
    name: 'web must not reach into Tesla provider code',
    file: 'apps/web/src/x.ts',
    code: "import { a } from '../../worker/src/providers/tesla/x';\nvoid a;\n",
    rule: 'no-restricted-imports',
  },
  {
    name: 'web must not reference the Supabase secret key',
    file: 'apps/web/src/x.ts',
    code: 'export const k = import.meta.env.SUPABASE_SECRET_KEY;\n',
    rule: 'no-restricted-syntax',
  },
  {
    name: 'worker must not import web',
    file: 'apps/worker/src/x.ts',
    code: "import { a } from '@autopw3/web';\nvoid a;\n",
    rule: 'no-restricted-imports',
  },
  {
    name: 'domain must not call Date.now()',
    file: 'packages/domain/src/x.ts',
    code: 'export const t = Date.now();\n',
    rule: 'no-restricted-syntax',
  },
  {
    name: 'domain must not call new Date()',
    file: 'packages/domain/src/x.ts',
    code: 'export const t = new Date();\n',
    rule: 'no-restricted-syntax',
  },
  {
    name: 'domain must not use Math.random()',
    file: 'packages/domain/src/x.ts',
    code: 'export const t = Math.random();\n',
    rule: 'no-restricted-syntax',
  },
  {
    name: 'domain must not use fetch',
    file: 'packages/domain/src/x.ts',
    code: "export const t = fetch('x');\n",
    rule: 'no-restricted-globals',
  },
  {
    name: 'no parseFloat for money (any package)',
    file: 'apps/worker/src/x.ts',
    code: "export const t = parseFloat('1.20');\n",
    rule: 'no-restricted-syntax',
  },
  {
    name: 'no toFixed for money (any package)',
    file: 'apps/web/src/x.ts',
    code: 'export const t = (1.2).toFixed(2);\n',
    rule: 'no-restricted-syntax',
  },
];

// Things that must stay allowed.
const allowed = [
  {
    name: 'domain may import shared',
    file: 'packages/domain/src/x.ts',
    code: "import { ROLES } from '@autopw3/shared';\nexport const r = ROLES;\n",
  },
  {
    name: 'domain may build a Date from an explicit value',
    file: 'packages/domain/src/x.ts',
    code: "export const t = new Date('2026-01-01T00:00:00Z');\n",
  },
  {
    name: 'web may import shared and domain',
    file: 'apps/web/src/x.ts',
    code: "import { ROLES } from '@autopw3/shared';\nimport { FixedClock } from '@autopw3/domain';\nexport const r = [ROLES, FixedClock];\n",
  },
];

const eslint = new ESLint({ cwd: process.cwd() });
let failures = 0;

for (const c of cases) {
  const [result] = await eslint.lintText(c.code, { filePath: c.file });
  const hit = result.messages.some((m) => m.ruleId === c.rule);
  if (!hit) {
    failures += 1;
    console.error(`FAIL  expected rule ${c.rule} to fire: ${c.name}`);
  } else {
    console.log(`ok    ${c.name}`);
  }
}

for (const c of allowed) {
  const [result] = await eslint.lintText(c.code, { filePath: c.file });
  const errors = result.messages.filter((m) => m.severity === 2);
  if (errors.length > 0) {
    failures += 1;
    console.error(
      `FAIL  should be allowed: ${c.name} -> ${errors.map((m) => m.message).join('; ')}`,
    );
  } else {
    console.log(`ok    allowed: ${c.name}`);
  }
}

if (failures > 0) {
  console.error(`${failures} lint-rule check(s) failed`);
  process.exit(1);
}
console.log('All lint-rule checks passed');
