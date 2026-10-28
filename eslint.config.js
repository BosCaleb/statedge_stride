// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/** Spec: no default exports except where a framework requires them. */
const noDefaultExport = {
  selector: 'ExportDefaultDeclaration',
  message: 'Use named exports. Default exports are allowed only where a framework requires them.',
};

/** Spec: no barrel files that hide dependency direction. */
const noReExports = [
  {
    selector: 'ExportAllDeclaration',
    message: 'No barrel files: import from the module that defines the symbol.',
  },
  {
    selector: 'ExportNamedDeclaration[source]',
    message: 'No barrel files: import from the module that defines the symbol.',
  },
];

/** Spec: parameterised queries only. A lint rule forbids string-built SQL. */
const noStringBuiltSql = [
  {
    selector:
      'CallExpression[callee.property.name=/^(query|batch)$/] > TemplateLiteral[expressions.length>0]',
    message: 'No string-built SQL. Use a static query string with request.input() parameters.',
  },
  {
    selector: 'CallExpression[callee.property.name=/^(query|batch)$/] > BinaryExpression',
    message: 'No string-built SQL. Use a static query string with request.input() parameters.',
  },
];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    'apps/api/.deploy/**',
    'apps/web/public/**',
    '**/playwright-report/**',
    '**/test-results/**',
    'infra/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      'no-restricted-syntax': ['error', noDefaultExport, ...noReExports],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Dependency direction: nothing in packages/* may import from apps/*.
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@stride/web', '@stride/web/*', '@stride/api', '@stride/api/*', '**/apps/**'],
              message: 'packages/* must not import from apps/*.',
            },
          ],
        },
      ],
    },
  },
  {
    // packages/analysis is pure: it may import only from packages/shared (no DOM, network or model).
    files: ['packages/analysis/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\.{1,2}/|@stride/shared/).+',
              message:
                'packages/analysis may import only relative modules and @stride/shared/* (keep it pure).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', noDefaultExport, ...noReExports, ...noStringBuiltSql],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // Frameworks that require a default export from their config files.
    files: [
      'eslint.config.js',
      '**/vite.config.ts',
      '**/vitest.config.ts',
      '**/vitest.*.config.ts',
      '**/playwright.config.ts',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...noReExports],
    },
  },
]);
