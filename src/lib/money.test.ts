import { describe, expect, it } from 'vitest'
import { formatMoney, parseAmount } from './money'

describe('HKD money helpers', () => {
  it('formats integer minor units as HKD with two decimal places', () => {
    expect(formatMoney(12_345)).toMatch(/HK\$123\.45/)
    expect(formatMoney(5)).toMatch(/HK\$0\.05/)
    expect(formatMoney(12_345, 'HKD', 'fr')).toMatch(/123,45\sHKD/)
  })

  it.each([
    ['123.45', 12_345],
    ['123', 12_300],
    ['0.5', 50],
    ['0.05', 5],
    [' 88.00 ', 8_800],
  ])('parses %s dollars without floating-point arithmetic', (value, expected) => {
    expect(parseAmount(value)).toBe(expected)
  })

  it('accepts a decimal comma for French input', () => {
    expect(parseAmount('123,45', 'fr')).toBe(12_345)
  })

  it.each(['', '0', '0.00', '-1', '1.234', '1,000', 'abc', '90071992547409.92'])(
    'rejects unsafe or invalid amount %s',
    (value) => {
      expect(() => parseAmount(value)).toThrow()
    },
  )
})
