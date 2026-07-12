import { describe, expect, it } from 'vitest'
import { translate, type Locale, type Translator } from '../i18n'
import { getDemoTransactions } from './demo'

function translator(locale: Locale): Translator {
  return (key, values) => translate(locale, key, values)
}

describe('localized demo data', () => {
  it.each([
    ['zh-Hant', '超級市場'],
    ['en', 'Supermarket'],
    ['ja', 'スーパーマーケット'],
    ['fr', 'Supermarché'],
  ] satisfies ReadonlyArray<readonly [Locale, string]>)('localizes built-in demo copy for %s', (locale, expected) => {
    const transactions = getDemoTransactions('2026-07', 'all', '', translator(locale))
    expect(transactions[0]?.payee).toBe(expected)
  })

  it('searches localized demo copy', () => {
    expect(getDemoTransactions('2026-07', 'all', 'supermarket', translator('en'))).toHaveLength(1)
    expect(getDemoTransactions('2026-07', 'all', 'supermarché', translator('fr'))).toHaveLength(1)
  })
})
