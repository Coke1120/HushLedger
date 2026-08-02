import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const contextSource = readFileSync(
  new URL('./aiCopilotContext.ts', import.meta.url),
  'utf8',
)
const repositorySource = readFileSync(
  new URL('./aiCopilotReadRepository.ts', import.meta.url),
  'utf8',
)

describe('AI Copilot read capability boundary', () => {
  it('keeps raw database access and mutation dependencies out of context assembly', () => {
    assert.doesNotMatch(contextSource, /\bD1Database\b/)
    assert.doesNotMatch(contextSource, /\.prepare\s*\(/)
    assert.doesNotMatch(contextSource, /\.batch\s*\(/)
    assert.doesNotMatch(contextSource, /from ['"]\.\/(?:money|ledgerSettings)['"]/)
    assert.doesNotMatch(
      contextSource,
      /\b(?:create|update|delete|save|set|restore|import)(?:Account|Category|Transaction|Ledger|Backup)\w*/,
    )
    assert.match(
      contextSource,
      /import type \{ AiCopilotReadRepository \} from '\.\/aiCopilotReadRepository'/,
    )
  })

  it('builds insight coverage and preview from one repository source load', () => {
    const listInsightsBody = contextSource.match(
      /export async function listAiCopilotInsights[\s\S]*?\n\}/,
    )?.[0]

    assert.ok(listInsightsBody)
    assert.equal(
      [...listInsightsBody.matchAll(/loadAiCopilotContextSource\(/g)].length,
      1,
    )
    assert.match(listInsightsBody, /const context = buildAiCopilotContext\(source\)/)
    assert.match(listInsightsBody, /preview: context/)
  })

  it('exposes only the five intended read capabilities', () => {
    const interfaceBody = repositorySource.match(
      /export type AiCopilotReadRepository = \{([\s\S]*?)\n\}/,
    )?.[1]

    assert.ok(interfaceBody)
    assert.deepEqual(
      [...interfaceBody.matchAll(/^\s{2}(\w+)\(/gm)].map((match) => match[1]),
      [
        'getSummary',
        'listAccounts',
        'listCategories',
        'getLedgerCurrencySettings',
        'summarizeTransactions',
      ],
    )
  })

  it('delegates exclusively to the existing read helpers', () => {
    assert.match(
      repositorySource,
      /import \{ getLedgerCurrencySettings \} from '\.\/ledgerSettings'/,
    )
    const moneyImports = repositorySource.match(
      /import \{([^}]*)\} from '\.\/money'/,
    )?.[1]

    assert.ok(moneyImports)
    assert.deepEqual(
      moneyImports.split(',').map((name) => name.trim()).filter(Boolean),
      ['getSummary', 'listAccounts', 'listCategories', 'summarizeTransactions'],
    )
    assert.doesNotMatch(repositorySource, /\.prepare\s*\(/)
    assert.doesNotMatch(repositorySource, /\.batch\s*\(/)
  })
})
