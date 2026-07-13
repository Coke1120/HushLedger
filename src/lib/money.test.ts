import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatAmountInput, formatMoney, parseAmount } from './money'

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
})
