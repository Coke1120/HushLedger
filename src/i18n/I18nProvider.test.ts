import { describe, expect, it } from 'vitest'
import {
  dictionaries,
  resolveLocale,
  supportedLocales,
  translate,
  type Locale,
} from './core'

describe('locale resolution', () => {
  it('prefers a valid stored locale', () => {
    expect(resolveLocale('fr', ['ja-JP'])).toBe('fr')
  })

  it.each([
    [['zh-TW'], 'zh-Hant'],
    [['en-GB'], 'en'],
    [['ja-JP'], 'ja'],
    [['fr-CA'], 'fr'],
    [['de-DE'], 'zh-Hant'],
  ] as const)('maps browser languages %j to %s', (languages, expected) => {
    expect(resolveLocale(null, languages)).toBe(expected)
  })

  it('ignores an invalid persisted locale', () => {
    expect(resolveLocale('de', ['en-US'])).toBe('en')
  })
})

describe('message catalogs', () => {
  it('keeps identical keys in all four catalogs', () => {
    const expected = Object.keys(dictionaries['zh-Hant']).sort()
    for (const locale of supportedLocales) {
      expect(Object.keys(dictionaries[locale]).sort()).toEqual(expected)
    }
  })

  it.each([
    ['zh-Hant', '3 筆交易'],
    ['en', '3 transactions'],
    ['ja', '3件の取引'],
    ['fr', '3 opérations'],
  ] satisfies ReadonlyArray<readonly [Locale, string]>)('interpolates counts for %s', (locale, expected) => {
    expect(translate(locale, 'transactionCount', { count: 3 })).toBe(expected)
  })

  it('uses locale-aware singular messages', () => {
    expect(translate('en', 'transactionCount', { count: 1 })).toBe('1 transaction')
    expect(translate('fr', 'recurringRuleCount', { count: 1 })).toBe('1 règle')
    expect(translate('fr', 'recurringRuleCount', { count: 0 })).toBe('0 règles')
  })

  it('preserves interpolation placeholders in every locale', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]).sort()
    for (const key of Object.keys(dictionaries['zh-Hant']) as Array<keyof typeof dictionaries['zh-Hant']>) {
      const expected = placeholders(dictionaries['zh-Hant'][key])
      for (const locale of supportedLocales) {
        expect(placeholders(dictionaries[locale][key]), `${locale}.${key}`).toEqual(expected)
      }
    }
  })

  it('keeps unknown interpolation tokens visible for translation QA', () => {
    expect(translate('en', 'generatedByRule')).toContain('{name}')
  })
})
