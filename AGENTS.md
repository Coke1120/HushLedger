# Repository Guidelines

## Project Structure & Module Organization

HushLedger is a Next.js 16 App Router application deployed through OpenNext to Cloudflare Workers and D1. Routes and server actions live in `src/app/`; reusable UI is in `src/components/`; domain helpers, schemas, and client APIs belong in `src/lib/`; server-only logic belongs in `src/server/`; hooks and translations live in `src/hooks/` and `src/i18n/`. Worker cron and access code is under `worker/`. Keep D1 changes as ordered SQL files in `migrations/`, static assets in `public/`, deployment guidance in `docs/`, and visual references in `design/`.

## Build, Test, and Development Commands

- `npm ci` installs the locked dependencies (Node 22+, npm 10+).
- `npm run db:local` applies all migrations to the local D1 database.
- `npm run dev` starts the loopback-only Next.js development server.
- `npm test` runs TypeScript unit tests and local-state script tests.
- `npm run typecheck` runs strict TypeScript checks without emitting files.
- `npm run lint` runs ESLint and oxlint with warnings rejected.
- `npm run build` builds Next.js; `npm run preview` exercises the OpenNext Worker runtime.
- `npm run verify` runs the complete test, type, lint, build, Worker-build, and integration gate used by CI.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, single quotes, no semicolons, and trailing commas in multiline constructs, matching nearby files. Use `PascalCase` for React components, `camelCase` for functions and hooks (`useMoneyData`), and descriptive lowercase migration names such as `0021_ai_provider_settings.sql`. Prefer `@/` imports for cross-directory source references and `import type` for type-only imports. Put all user-facing copy in `src/i18n/messages.ts` and update every locale.

## Testing Guidelines

Tests use `node:test` with `node:assert/strict` and are co-located as `*.test.ts`; server suites may use `*.server.test.ts`. Add focused regressions for every behavior change. There is no numeric coverage threshold, but PRs must pass `npm run verify`; schema changes must exercise fresh and upgrade migration paths.

## Commit & Pull Request Guidelines

Write intent-first commit subjects, for example `Keep public reference data opt-in and auditable`. Follow the repository’s Lore trailers where relevant: `Constraint:`, `Rejected:`, `Confidence:`, `Scope-risk:`, `Directive:`, `Tested:`, and `Not-tested:`. Keep PRs focused and describe the outcome, verification, migration/recovery impact, and limitations. Link related issues and include redacted screenshots for UI changes.

## Security & Data Safety

Never commit secrets, `.wrangler/`, local databases, exports, backups, or real financial data. Store money as integer minor units and transaction dates as `YYYY-MM-DD`. Report vulnerabilities privately as directed by `SECURITY.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
