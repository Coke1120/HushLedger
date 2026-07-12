import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatMoney } from './money'
import { formatMoneyForDisplay, formatPrivateMoney } from './privacy'

describe('screen privacy formatting', () => {
  it('preserves normal localized money when privacy mode is off', () => {
    assert.equal(
      formatMoneyForDisplay(12_345, 'HKD', 'en', false),
      formatMoney(12_345, 'HKD', 'en'),
    )
  })

  it('hides sign, magnitude, and decimals behind one stable currency mask', () => {
    const expected = formatPrivateMoney('HKD', 'en')
    assert.match(expected, /HK\$|HKD/)
    assert.doesNotMatch(expected, /\d/)
    assert.equal(formatMoneyForDisplay(5, 'HKD', 'en', true), expected)
    assert.equal(formatMoneyForDisplay(-9_876_543, 'HKD', 'en', true), expected)
  })

  it('keeps each locale currency placement without exposing a number', () => {
    for (const locale of ['zh-Hant', 'en', 'ja', 'fr']) {
      const masked = formatPrivateMoney('HKD', locale)
      assert.ok(masked.includes('••••'))
      assert.doesNotMatch(masked, /\d/)
    }
  })
})
