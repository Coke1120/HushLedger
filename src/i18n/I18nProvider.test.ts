import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  dictionaries,
  resolveLocale,
  supportedLocales,
  translate,
  type Locale,
} from './core'
import { messageForError } from './localizedMessage'
import { ApiError } from '../lib/api'

describe('locale resolution', () => {
  it('prefers a valid stored locale', () => {
    assert.equal(resolveLocale('fr', ['ja-JP']), 'fr')
  })

  for (const [languages, expected] of [
    [['zh-TW'], 'zh-Hant'],
    [['en-GB'], 'en'],
    [['ja-JP'], 'ja'],
    [['fr-CA'], 'fr'],
    [['de-DE'], 'zh-Hant'],
  ] as const) {
    it(`maps browser languages ${JSON.stringify(languages)} to ${expected}`, () => {
      assert.equal(resolveLocale(null, languages), expected)
    })
  }

  it('ignores an invalid persisted locale', () => {
    assert.equal(resolveLocale('de', ['en-US']), 'en')
  })
})

describe('message catalogs', () => {
  it('keeps identical keys in all four catalogs', () => {
    const expected = Object.keys(dictionaries['zh-Hant']).sort()
    for (const locale of supportedLocales) {
      assert.deepEqual(Object.keys(dictionaries[locale]).sort(), expected)
    }
  })

  for (const [locale, expected] of [
    ['zh-Hant', '3 筆交易'],
    ['en', '3 transactions'],
    ['ja', '3件の取引'],
    ['fr', '3 opérations'],
  ] satisfies ReadonlyArray<readonly [Locale, string]>) {
    it(`interpolates counts for ${locale}`, () => {
      assert.equal(translate(locale, 'transactionCount', { count: 3 }), expected)
    })
  }

  it('uses locale-aware singular messages', () => {
    assert.equal(translate('en', 'transactionCount', { count: 1 }), '1 transaction')
    assert.equal(translate('en', 'loadMoreTransactions', { count: 1 }), 'Load 1 more transaction')
    assert.equal(translate('fr', 'recurringRuleCount', { count: 1 }), '1 règle')
    assert.equal(translate('fr', 'recurringRuleCount', { count: 0 }), '0 règles')
    assert.equal(
      translate('en', 'reconciliationReviewHelp', { count: 1, visible: 1 }),
      '1 uncleared entry remains through the statement close; 1 is visible in the selected period. Every running and cutoff balance includes complete ledger activity through the close date.',
    )
    assert.equal(
      translate('en', 'reconciliationReviewHelpLimited', {
        count: 1,
        loaded: 200,
        total: 201,
        visible: 1,
      }),
      '1 uncleared entry remains through the statement close. The newest 200 of 201 period entries are loaded and 1 is visible. An older or out-of-period uncleared entry may not be loaded; every running and cutoff balance still uses the complete ledger.',
    )
    assert.equal(
      translate('en', 'csvImportSummaryMatchable', { count: 1 }),
      '1 exact match',
    )
  })

  it('describes due recurrence dates without promising that generation can succeed', () => {
    assert.equal(
      translate('en', 'recurringDueCount', { count: 2 }),
      '2 due for generation, shown first',
    )
  })

  it('describes recurring amount differences without inferring a cause or changing data', () => {
    assert.equal(
      translate('en', 'recurringAmountReviewDetails', {
        date: 'July 14',
        recorded: 'HK$120.00',
        future: 'HK$125.00',
      }),
      'Latest generated entry (July 14): HK$120.00. Future rule: HK$125.00.',
    )
    assert.equal(
      translate('en', 'recurringAmountReviewHelp'),
      'Amounts can vary. Check a statement or other source record before changing this rule. A difference alone is not an error, and HushLedger does not change either amount.',
    )
  })

  it('keeps the rolling outlook local, date-bounded, and non-promissory', () => {
    assert.equal(
      translate('en', 'scheduledOutlookHelp'),
      'Ungenerated dates and amounts from active local ledger rules. They are not bank confirmation, actual transactions, available balance or runway, or guaranteed dates or amounts. Select an entry to manage its rule.',
    )
    assert.equal(
      translate('en', 'scheduledOutlookRange', { from: 'July 14', to: 'August 17' }),
      'Outlook dates: July 14 through August 17, inclusive.',
    )
    assert.equal(
      translate('en', 'scheduledOutlookCashFlowPeriodsHelp'),
      'Five consecutive 7-day periods cover the displayed range. They include only ungenerated recurring transaction rules; scheduled transfers remain separate and never enter these totals.',
    )
  })

  it('limits backup health claims to browser-local preparation records', () => {
    assert.equal(
      translate('en', 'ledgerBackupHealthDue', { count: 30 }),
      'Backup reminder: this browser has no record of preparing a ledger download in the last 30 days.',
    )
    assert.equal(
      translate('en', 'overviewBackupReminderHelp', { count: 30 }),
      'This browser has no record of HushLedger preparing a ledger download in the last 30 days. It cannot tell whether another copy exists or can be restored.',
    )
    assert.equal(
      translate('en', 'ledgerBackupHealthLocalOnly'),
      'These dates stay in this browser. They do not prove where a file is stored or that it can be restored.',
    )
  })

  it('preserves interpolation placeholders in every locale', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]).sort()
    for (const key of Object.keys(dictionaries['zh-Hant']) as Array<keyof typeof dictionaries['zh-Hant']>) {
      const expected = placeholders(dictionaries['zh-Hant'][key])
      for (const locale of supportedLocales) {
        assert.deepEqual(placeholders(dictionaries[locale][key]), expected, `${locale}.${key}`)
      }
    }
  })

  it('names both recurring transaction and scheduled transfer blockers in every locale', () => {
    for (const [locale, recurringTransaction, scheduledTransfer] of [
      ['zh-Hant', '週期交易', '定期轉帳'],
      ['en', 'recurring transactions', 'scheduled transfers'],
      ['ja', '定期取引', '定期振替'],
      ['fr', 'opérations récurrentes', 'virements programmés'],
    ] satisfies ReadonlyArray<readonly [Locale, string, string]>) {
      for (const key of ['referenceHistoryHelp', 'errorReferenceActiveRules'] as const) {
        const message = translate(locale, key)
        assert.ok(message.includes(recurringTransaction), `${locale}.${key} omits recurring transactions`)
        assert.ok(message.includes(scheduledTransfer), `${locale}.${key} omits scheduled transfers`)
      }
    }
  })

  it('keeps scheduled-transfer conflicts distinct from recurring-transaction conflicts', () => {
    assert.equal(
      messageForError(
        new ApiError('stale', 'RECURRING_TRANSFER_RULE_VERSION_CONFLICT', 409),
        'scheduledTransferUpdateFailed',
      ).key,
      'errorRecurringTransferRuleVersionConflict',
    )
    assert.equal(
      messageForError(
        new ApiError('missing', 'RECURRING_TRANSFER_RULE_NOT_FOUND', 404),
        'scheduledTransferUpdateFailed',
      ).key,
      'errorRecurringTransferRuleNotFound',
    )

    for (const [locale, scheduledTransfer] of [
      ['zh-Hant', '定期轉帳'],
      ['en', 'scheduled transfer'],
      ['ja', '定期振替'],
      ['fr', 'virement programmé'],
    ] satisfies ReadonlyArray<readonly [Locale, string]>) {
      assert.ok(
        translate(locale, 'errorRecurringTransferRuleNotFound')
          .toLocaleLowerCase(locale)
          .includes(scheduledTransfer.toLocaleLowerCase(locale)),
        `${locale} scheduled-transfer not-found message uses the wrong workflow name`,
      )
      assert.ok(
        translate(locale, 'errorRecurringTransferRuleVersionConflict')
          .toLocaleLowerCase(locale)
          .includes(scheduledTransfer.toLocaleLowerCase(locale)),
        `${locale} scheduled-transfer conflict message uses the wrong workflow name`,
      )
    }
  })

  it('keeps unknown interpolation tokens visible for translation QA', () => {
    assert.ok(translate('en', 'generatedByRule').includes('{name}'))
  })

  it('shows an unknown runtime key instead of crashing during app-shell version skew', () => {
    const runtimeTranslate = translate as (locale: Locale, key: string) => string
    assert.equal(
      runtimeTranslate('en', 'cashFlowTrendFromNewerShell'),
      'cashFlowTrendFromNewerShell',
    )
  })
})
