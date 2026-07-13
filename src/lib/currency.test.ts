import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  currencyDisplayName,
  DEFAULT_LEDGER_CURRENCY,
  SUPPORTED_CURRENCIES,
  supportedCurrencySchema,
} from './currency'

describe('ledger currency contract', () => {
  it('defaults to HKD and accepts only the supported two-decimal currencies', () => {
    assert.equal(DEFAULT_LEDGER_CURRENCY, 'HKD')

    for (const currency of SUPPORTED_CURRENCIES) {
      assert.equal(supportedCurrencySchema.parse(currency), currency)

      const options = new Intl.NumberFormat('en', {
        style: 'currency',
        currency,
      }).resolvedOptions()
      assert.equal(options.minimumFractionDigits, 2, currency)
      assert.equal(options.maximumFractionDigits, 2, currency)
    }

    for (const currency of ['JPY', 'KWD', 'IDR', 'XYZ', 'hkd']) {
      assert.equal(supportedCurrencySchema.safeParse(currency).success, false, currency)
    }
  })

  it('labels currencies with their code and localized name', () => {
    assert.match(currencyDisplayName('HKD', 'en'), /^HKD — /)
    assert.equal(currencyDisplayName('HKD', '_'), 'HKD')
  })
})
