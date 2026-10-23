// ESLint flat config. Enforces:
//  - the import-direction table in docs/ai-build-kit/04-REPO-STRUCTURE.md section 2,
//  - no direct system time in packages/domain (inject a Clock),
//  - a heuristic "no float money" rule (decimal.js only; see docs/DEVELOPMENT_SETUP.md).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const NAMES = {
  shared: '@autopw3/shared',
  domain: '@autopw3/domain',
  web: '@autopw3/web',
  worker: '@autopw3/worker',
};

/** Build a no-restricted-imports config forbidding the given workspace packages and path patterns. */
function forbidImports({ packages, patterns = [], reason }) {
  return [
    'error',
    {
      paths: packages.map((name) => ({
        name,
        message: `${reason} (04-REPO-STRUCTURE.md section 2)`,
      })),
      patterns: [
        ...packages.map((name) => ({
          group: [`${name}/*`],
          message: `${reason} (04-REPO-STRUCTURE.md section 2)`,
        })),
        ...patterns,
      ],
    },
  ];
}

// Heuristic float-money guard: money is decimal-safe (decimal.js), never floats (D-014).
// parseFloat and toFixed are the usual ways floats sneak into money code.
const NO_FLOAT_MONEY = [
  {
    selector: "CallExpression[callee.name='parseFloat']",
    message: 'Do not parse money with parseFloat. Use decimal.js (D-014).',
  },
  {
    selector: "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
    message: 'Do not parse money with Number.parseFloat. Use decimal.js (D-014).',
  },
  {
    selector: "CallExpression[callee.property.name='toFixed']",
    message: 'Do not format money with toFixed. Use decimal.js and the money formatter (D-014).',
  },
];

// Pure domain code never reads the clock or randomness directly: inject a Clock (04-REPO-STRUCTURE.md).
const NO_AMBIENT_TIME = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Domain code must not call Date.now(). Inject a Clock.',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'Domain code must not call new Date() without arguments. Inject a Clock.',
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: 'Domain code must be deterministic. Do not use Math.random().',
  },
  {
    selector: "CallExpression[callee.object.name='performance'][callee.property.name='now']",
    message: 'Domain code must not read performance.now(). Inject a Clock.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.wrangler/**',
      '**/worker-configuration.d.ts',
      'supabase/**',
      'docs/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': ['error', ...NO_FLOAT_MONEY],
    },
  },

  // Plain JS/config files run in Node.
  {
    files: ['*.js', '*.mjs', '*.cjs', 'scripts/**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },

  // packages/shared: types, schemas, constants only. No app code, no domain logic.
  {
    files: ['packages/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': forbidImports({
        packages: [NAMES.domain, NAMES.web, NAMES.worker],
        patterns: [
          {
            group: ['**/apps/**', '**/packages/domain/**'],
            message: 'shared imports nothing app-specific',
          },
        ],
        reason: 'packages/shared must not import domain or apps',
      }),
    },
  },

  // packages/domain: imports shared only; deterministic; no network.
  {
    files: ['packages/domain/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': forbidImports({
        packages: [NAMES.web, NAMES.worker],
        patterns: [{ group: ['**/apps/**'], message: 'domain must not import apps' }],
        reason: 'packages/domain may import only @autopw3/shared',
      }),
      'no-restricted-syntax': ['error', ...NO_FLOAT_MONEY, ...NO_AMBIENT_TIME],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Domain code does no I/O.' },
        { name: 'XMLHttpRequest', message: 'Domain code does no I/O.' },
        { name: 'WebSocket', message: 'Domain code does no I/O.' },
      ],
    },
  },
  // Domain tests may read ambient time only to prove it is not needed; keep the import rule.
  {
    files: ['packages/domain/**/*.test.ts'],
    rules: {
      'no-restricted-imports': forbidImports({
        packages: [NAMES.web, NAMES.worker],
        patterns: [{ group: ['**/apps/**'], message: 'domain must not import apps' }],
        reason: 'packages/domain may import only @autopw3/shared',
      }),
    },
  },

  // apps/web: shared and domain only. No worker code, no Tesla code, no service-role keys.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-imports': forbidImports({
        packages: [NAMES.worker],
        patterns: [
          {
            group: ['**/apps/worker/**', '**/worker/src/**'],
            message: 'web must not import the Worker',
          },
          { group: ['**/providers/tesla/**'], message: 'Tesla code is server-side only' },
        ],
        reason: 'apps/web must not import apps/worker',
      }),
      'no-restricted-syntax': [
        'error',
        ...NO_FLOAT_MONEY,
        {
          selector:
            'MemberExpression[property.name=/^(SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY)$/]',
          message: 'Service-role keys must never be referenced in the browser app.',
        },
      ],
    },
  },

  // apps/worker: shared and domain only; never the web app.
  {
    files: ['apps/worker/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.serviceworker } },
    rules: {
      'no-restricted-imports': forbidImports({
        packages: [NAMES.web],
        patterns: [{ group: ['**/apps/web/**'], message: 'worker must not import the web app' }],
        reason: 'apps/worker must not import apps/web',
      }),
    },
  },

  // Test files: Node globals (vitest runs in Node/jsdom).
  {
    files: ['**/*.test.{ts,tsx}', '**/vitest.config.ts', '**/vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
