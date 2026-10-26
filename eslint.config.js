import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    '.next/**',
    '.open-next/**',
    'node_modules/**',
    '.wrangler/**',
    '.omx/**',
    'worker-configuration.d.ts',
  ]),
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Keep Cloudflare's vendored CommonJS validators unchanged.
    files: ['.cursor/skills/security-audit/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': ['error', {
        allow: ['^node:', '^(?:fs|path|util)$', '^\\./(?:report-schema\\.json|validate-(?:findings|coverage-ledger)\\.cjs)$'],
      }],
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^error$',
      }],
    },
  },
])
