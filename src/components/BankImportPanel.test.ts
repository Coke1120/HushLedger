import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nContext, type I18nContextValue } from '../i18n/context'
import { translate } from '../i18n/core'
import {
  autoSelectedBankImportKeys,
  type BankStatementVerification,
} from '../lib/ai'
import { formatMoneyForDisplay } from '../lib/privacy'
import {
  BankStatementVerificationSummary,
} from './BankImportPanel'

const panelSource = readFileSync(new URL('./BankImportPanel.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

const context: I18nContextValue = {
  locale: 'en',
  setLocale: () => undefined,
  ledgerCurrency: 'HKD',
  setLedgerCurrency: () => undefined,
  privacyMode: false,
  setPrivacyMode: () => undefined,
  t: (key, values) => translate('en', key, values),
  formatMoney: (minor, currency = 'HKD') =>
    formatMoneyForDisplay(minor, currency, 'en', false),
  formatMonth: (month) => month,
  formatDate: (date) => date,
  formatNumber: String,
  localizeEntityName: (name) => name,
}

const verification: BankStatementVerification = {
  status: 'matched',
  openingBalance: null,
  closingBalance: null,
  debitTotal: null,
  creditTotal: null,
  parsedIncomeMinor: 20_000,
  parsedExpenseMinor: 12_000,
  parsedNetMinor: 8_000,
  balanceDifferenceMinor: 0,
  debitDifferenceMinor: 0,
  creditDifferenceMinor: null,
  runningBalanceStatus: 'matched',
  runningBalanceCheckedRows: 2,
  runningBalanceMismatchSourceLines: [],
}

function renderVerification(value: BankStatementVerification) {
  return renderToStaticMarkup(createElement(
    I18nContext.Provider,
    { value: context },
    createElement(BankStatementVerificationSummary, {
      currency: 'HKD',
      verification: value,
    }),
  ))
}

describe('bank statement fast-path selection', () => {
  const rows = [
    { sourceRow: 1, importKey: 'safe-new', status: 'new' as const },
    { sourceRow: 2, importKey: 'safe-match', status: 'match_ready' as const },
    { sourceRow: 3, importKey: 'flagged', status: 'new' as const },
    { sourceRow: 4, importKey: 'duplicate', status: 'possible_duplicate' as const },
    { sourceRow: 5, importKey: 'category-fallback', status: 'new' as const },
  ]
  const drafts = [
    { importKey: 'safe-new', flags: [] },
    { importKey: 'safe-match', flags: [] },
    { importKey: 'flagged', flags: ['POSSIBLE_TRANSFER' as const] },
    { importKey: 'duplicate', flags: [] },
    { importKey: 'category-fallback', flags: ['UNCERTAIN_CATEGORY' as const] },
  ]

  it('selects balance-safe rows, including category-only fallback warnings', () => {
    assert.deepEqual(
      [...autoSelectedBankImportKeys(drafts, rows)],
      ['safe-new', 'safe-match', 'category-fallback'],
    )
  })

  it('selects nothing when statement reconciliation blocks the fast path', () => {
    assert.deepEqual([...autoSelectedBankImportKeys(drafts, rows, false)], [])
  })

  it('announces matched, mismatched, and unavailable arithmetic checks', () => {
    const matched = renderVerification(verification)
    const mismatch = renderVerification({
      ...verification,
      status: 'mismatch',
      balanceDifferenceMinor: 500,
    })
    const unavailable = renderVerification({
      ...verification,
      status: 'unavailable',
      balanceDifferenceMinor: null,
      debitDifferenceMinor: null,
    })

    assert.match(matched, /Available statement balances and totals match/)
    assert.match(mismatch, /Fast selection is off/)
    assert.match(mismatch, /Balance difference \(statement minus calculated\)/)
    assert.doesNotMatch(mismatch, /Debit-total difference/)
    assert.match(unavailable, /too little balance or total data/)
    assert.match(matched, /Running balances match across 2 checked transactions/)
    assert.match(renderVerification({
      ...verification,
      status: 'mismatch',
      runningBalanceStatus: 'mismatch',
      runningBalanceMismatchSourceLines: [4],
    }), /1 transactions break the statement running-balance chain/)
  })

  it('clears stale preview state and requires exact preview key order before commit', () => {
    const analyzeSource = panelSource.slice(
      panelSource.indexOf('const analyze ='),
      panelSource.indexOf('const updateDraft ='),
    )
    const previewSource = panelSource.slice(
      panelSource.indexOf('const previewDrafts ='),
      panelSource.indexOf('const commitDrafts ='),
    )
    const commitSource = panelSource.slice(
      panelSource.indexOf('const commitDrafts ='),
      panelSource.indexOf('return (', panelSource.indexOf('const commitDrafts =')),
    )

    assert.match(
      analyzeSource,
      /setAnalyzing\(true\)[\s\S]*setDrafts\(\[\]\)[\s\S]*setVerificationEvidence\(null\)[\s\S]*setPreview\(null\)[\s\S]*setSelectedKeys\(new Set\(\)\)/,
    )
    assert.match(
      previewSource,
      /catch \(caught\)[\s\S]*setPreview\(null\)[\s\S]*setSelectedKeys\(new Set\(\)\)[\s\S]*errorAiPreviewFailed/,
    )
    assert.match(
      commitSource,
      /rows\.some\(\(row, index\) => row\.importKey !== preview\.rows\[index\]\?\.importKey\)/,
    )
  })

  it('auto-selects only fully matched or entirely unchecked statement arithmetic', () => {
    const helperSource = panelSource.slice(
      panelSource.indexOf('function canAutomaticallySelectBankImport'),
      panelSource.indexOf('function AiDraftDetails'),
    )
    const analyzeSource = panelSource.slice(
      panelSource.indexOf('const analyze ='),
      panelSource.indexOf('const updateDraft ='),
    )
    const previewSource = panelSource.slice(
      panelSource.indexOf('const previewDrafts ='),
      panelSource.indexOf('const commitDrafts ='),
    )

    assert.match(helperSource, /verification\?\.status === 'matched'/)
    assert.match(helperSource, /verification\?\.status === 'unavailable'/)
    assert.match(helperSource, /balanceDifferenceMinor === null/)
    assert.match(helperSource, /debitDifferenceMinor === null/)
    assert.match(helperSource, /creditDifferenceMinor === null/)
    assert.match(
      analyzeSource,
      /const evidence: BankStatementVerificationEvidence = \{[\s\S]*openingBalance:[\s\S]*closingBalance:[\s\S]*debitTotal:[\s\S]*creditTotal:[\s\S]*\}[\s\S]*recalculateVerification\(evidence, parsedResult\.data\.drafts\)/,
    )
    assert.match(
      analyzeSource,
      /canAutomaticallySelectBankImport\(recalculatedVerification\)/,
    )
    assert.match(
      previewSource,
      /allowAutomaticSelection = canAutomaticallySelectBankImport\(verification\)/,
    )
  })

  it('keeps draft details mounted while opening newly exceptional rows', () => {
    const detailsUsage = panelSource.slice(
      panelSource.indexOf('<AiDraftDetails'),
      panelSource.indexOf('</AiDraftDetails>'),
    )
    const detailsSource = panelSource.slice(panelSource.indexOf('function AiDraftDetails'))

    assert.doesNotMatch(detailsUsage.slice(0, detailsUsage.indexOf('>')), /\bkey=/)
    assert.match(
      detailsSource,
      /useEffect\(\(\) => \{\s*if \(initiallyOpen && detailsRef\.current\) detailsRef\.current\.open = true\s*\}, \[initiallyOpen\]\)/,
    )
    assert.doesNotMatch(detailsSource, /setOpen\(initiallyOpen\)/)
  })

  it('routes warning rows to follow-up and possible transfers through the dedicated endpoint', () => {
    const rowSource = panelSource.slice(
      panelSource.indexOf('function importRows'),
      panelSource.indexOf('function importStatusMessageKey'),
    )
    const transferSource = panelSource.slice(
      panelSource.indexOf('const createStatementTransfer'),
      panelSource.indexOf('return (', panelSource.indexOf('const createStatementTransfer')),
    )

    assert.match(
      rowSource,
      /initialReviewStatus: draftNeedsFollowUp\([^]*\) \? 'needs_follow_up' : undefined/,
    )
    assert.match(transferSource, /statementTransferImportInputSchema\.parse/)
    assert.match(transferSource, /draft\.type === 'expense' \? 'outflow' : 'inflow'/)
    assert.match(transferSource, /'\/api\/imports\/statement-transfer'/)
    assert.match(transferSource, /parsed\.data\.kind === 'matched'/)
    assert.match(transferSource, /STATEMENT_TRANSFER_POSSIBLE_DUPLICATE/)
    assert.match(transferSource, /transferDraftHasBlockingWarning\(draft\)/)
    assert.match(transferSource, /\|\| transferBusy/)
    assert.match(transferSource, /previewStatusByKey\.get\(draft\.importKey\) !== 'new'/)
    assert.match(panelSource, /disabled=\{transferBusy \|\| compatibleTransferAccounts\.length === 0\}/)
  })

  it('re-derives running-balance warnings after edits and uses them throughout import', () => {
    const helperSource = panelSource.slice(
      panelSource.indexOf('function effectiveBankImportDrafts'),
      panelSource.indexOf('function statementCompletionContext'),
    )
    const commitSource = panelSource.slice(
      panelSource.indexOf('const commitDrafts ='),
      panelSource.indexOf('const createStatementTransfer'),
    )

    assert.match(helperSource, /if \(!verification\) return drafts/)
    assert.match(helperSource, /flag !== 'RUNNING_BALANCE_MISMATCH'/)
    assert.match(helperSource, /mismatchSourceLines\.has\(draft\.sourceLine\)/)
    assert.match(panelSource, /nextDrafts = effectiveDrafts/)
    assert.match(panelSource, /effectiveDrafts\.map\(\(draft\) =>/)
    assert.match(commitSource, /importRows\(effectiveDrafts, previewStatusByKey\)/)
    assert.match(commitSource, /committedDrafts\.some\(\(draft\) => draftNeedsFollowUp/)
    assert.match(
      panelSource,
      /return draft\.flags\.length > 0 \|\| previewStatus === 'possible_duplicate'/,
    )
    assert.match(
      panelSource,
      /flag !== 'POSSIBLE_TRANSFER' && flag !== 'UNCERTAIN_CATEGORY'/,
    )
  })

  it('closes statement import before focusing the durable review queue', () => {
    const reviewSource = appSource.slice(
      appSource.indexOf('const openImportedTransactionReview'),
      appSource.indexOf('const applyAiCopilotAction'),
    )

    assert.match(reviewSource, /setImportMode\(null\)/)
    assert.match(reviewSource, /setImportReviewFilter\(reviewStatus\)/)
    assert.match(reviewSource, /transactionsPanelRef\.current\?\.focus\(\)/)
  })

  it('requires the printed statement close date to cover every handled draft', () => {
    const completionSource = panelSource.slice(
      panelSource.indexOf('{completedImport ?'),
      panelSource.indexOf('function aiFlagMessageKey'),
    )
    const contextSource = panelSource.slice(
      panelSource.indexOf('function statementCompletionContext'),
      panelSource.indexOf('function canAutomaticallySelectBankImport'),
    )

    assert.match(completionSource, /value=\{statementCloseDate\}/)
    assert.match(completionSource, /disabled=\{mutating \|\| !validStatementCloseDate\}/)
    assert.match(completionSource, /dateTo: statementCloseDate/)
    assert.match(completionSource, /min=\{completedImport\.latestEntryDate\}/)
    assert.match(
      panelSource,
      /statementCloseDate >= completedImport\.latestEntryDate/,
    )
    assert.match(contextSource, /dateFrom: dates\[0\] \?\? null/)
    assert.match(contextSource, /latestEntryDate: dates\.at\(-1\) \?\? null/)
    assert.match(contextSource, /function mergeCompletedImportActions/)
    assert.doesNotMatch(contextSource, /dateTo:/)
  })
})
