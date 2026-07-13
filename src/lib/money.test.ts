import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatAmountInput,
  formatMoney,
  formatSignedAmountInput,
  parseAmount,
  parseSignedAmount,
  resolveAmountInputLocale,
} from './money'

describe('HKD money helpers', () => {
  it('formats integer minor units as HKD with two decimal places', () => {
    assert.match(formatMoney(12_345), /HK\$123\.45/)
    assert.match(formatMoney(5), /HK\$0\.05/)
    assert.match(formatMoney(12_345, 'HKD', 'fr'), /123,45\sHKD/)
  })

  for (const [value, expected] of [
    ['123.45', 12_345],
    ['123', 12_300],
    ['0.5', 50],
    ['0.05', 5],
    [' 88.00 ', 8_800],
  ] as const) {
    it(`parses ${value} dollars without floating-point arithmetic`, () => {
      assert.equal(parseAmount(value), expected)
    })
  }

  it('accepts a decimal comma for French input', () => {
    assert.equal(parseAmount('123,45', 'fr'), 12_345)
  })

  it('preserves only an established French decimal convention across locale changes', () => {
    assert.equal(resolveAmountInputLocale('123,46', 'en', 'fr'), 'fr')
    assert.equal(resolveAmountInputLocale('123,46', 'fr', 'en'), 'fr')
    assert.equal(resolveAmountInputLocale('123,46', 'en', 'en'), 'en')
    assert.equal(resolveAmountInputLocale('123.46', 'en', 'fr'), 'en')
  })

  for (const [expression, expected] of [
    ['10 + 2.50', 1_250],
    ['2 + 3 * 4', 1_400],
    ['16.99 * 1.1', 1_869],
    ['(100 - 25) / 3', 2_500],
    ['1 / 3', 33],
  ] as const) {
    it(`evaluates ${expression} exactly and rounds only the final result`, () => {
      assert.equal(parseAmount(expression), expected)
    })
  }

  it('supports decimal commas throughout a French expression', () => {
    assert.equal(parseAmount('10,50 + 1,25', 'fr'), 1_175)
  })

  it('formats exact minor units for editing without floating-point conversion', () => {
    assert.equal(formatAmountInput(12_345), '123.45')
    assert.equal(formatAmountInput(5), '0.05')
    assert.equal(formatAmountInput(12_345, 'fr'), '123,45')
    assert.equal(formatAmountInput(Number.MAX_SAFE_INTEGER), '90071992547409.91')
  })

  for (const value of ['', '0', '0.00', '-1', '1.234', '1,000', 'abc', '90071992547409.92']) {
    it(`rejects unsafe or invalid amount ${value}`, () => {
      assert.throws(() => parseAmount(value))
    })
  }

  for (const value of [
    '1 / 0',
    '1 ++ 2',
    '2 ** 3',
    '10 - 10',
    '1e3 + 1',
    '1 + abc',
    '90071992547409.91 + 0.01',
  ]) {
    it(`rejects unsafe or invalid expression ${value}`, () => {
      assert.throws(() => parseAmount(value))
    })
  }

  it('rejects unsafe minor units when preparing an edit value', () => {
    assert.throws(() => formatAmountInput(Number.MAX_SAFE_INTEGER + 1))
  })

  it('parses and formats signed balances without floating-point arithmetic', () => {
    assert.equal(parseSignedAmount('-123.45'), -12_345)
    assert.equal(parseSignedAmount('0'), 0)
    assert.equal(parseSignedAmount('10 - 25'), -1_500)
    assert.equal(parseSignedAmount('-12,50', 'fr'), -1_250)
    assert.equal(formatSignedAmountInput(-12_345), '-123.45')
    assert.equal(formatSignedAmountInput(-12_345, 'fr'), '-123,45')
  })

  it('rejects malformed or unsafe signed balances', () => {
    assert.throws(() => parseSignedAmount(''))
    assert.throws(() => parseSignedAmount('1.234'))
    assert.throws(() => parseSignedAmount('90071992547409.92'))
  })
})
