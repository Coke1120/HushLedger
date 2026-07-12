import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatMoney, parseAmount } from './money'

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

  for (const value of ['', '0', '0.00', '-1', '1.234', '1,000', 'abc', '90071992547409.92']) {
    it(`rejects unsafe or invalid amount ${value}`, () => {
      assert.throws(() => parseAmount(value))
    })
  }
})
