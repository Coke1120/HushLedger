import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  dictionaries,
  resolveLocale,
  supportedLocales,
  translate,
  type Locale,
} from './core'

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
    assert.equal(translate('fr', 'recurringRuleCount', { count: 1 }), '1 règle')
    assert.equal(translate('fr', 'recurringRuleCount', { count: 0 }), '0 règles')
    assert.equal(
      translate('en', 'reconciliationReviewHelp', { count: 1 }),
      '1 uncleared entry is currently shown below. Use its status button to match your statement.',
    )
    assert.equal(
      translate('en', 'csvImportSummaryMatchable', { count: 1 }),
      '1 exact match',
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
