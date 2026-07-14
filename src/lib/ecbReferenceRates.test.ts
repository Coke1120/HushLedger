import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseEcbReferenceRatesCsv } from './ecbReferenceRates'

const header = [
  'KEY', 'FREQ', 'CURRENCY', 'CURRENCY_DENOM', 'EXR_TYPE', 'EXR_SUFFIX',
  'TIME_PERIOD', 'OBS_VALUE', 'OBS_STATUS',
].join(',')

function row(values: Partial<Record<string, string>> = {}) {
  const defaults = {
    KEY: 'EXR.D.USD.EUR.SP00.A', FREQ: 'D', CURRENCY: 'USD', CURRENCY_DENOM: 'EUR',
    EXR_TYPE: 'SP00', EXR_SUFFIX: 'A', TIME_PERIOD: '2026-07-13', OBS_VALUE: '1.1424',
    OBS_STATUS: 'A',
  }
  const merged = { ...defaults, ...values }
  return [
    merged.KEY, merged.FREQ, merged.CURRENCY, merged.CURRENCY_DENOM, merged.EXR_TYPE,
    merged.EXR_SUFFIX, merged.TIME_PERIOD, merged.OBS_VALUE, merged.OBS_STATUS,
  ].join(',')
}

describe('ECB reference-rate CSV parser', () => {
  it('keeps validated decimal text for supported daily EUR-base rates', () => {
    const rates = parseEcbReferenceRatesCsv(`${header}\n${row({ CURRENCY: 'HKD', OBS_VALUE: '9.1477' })}\n${row()}`)
    assert.deepEqual(rates, [
      { quoteCurrency: 'HKD', rate: '9.1477', observedOn: '2026-07-13' },
      { quoteCurrency: 'USD', rate: '1.1424', observedOn: '2026-07-13' },
    ])
  })

  it('rejects malformed, duplicate, or non-canonical values instead of accepting a partial snapshot', () => {
    assert.throws(() => parseEcbReferenceRatesCsv(`FREQ,CURRENCY\nD,USD`))
    assert.throws(() => parseEcbReferenceRatesCsv(`${header}\n${row()}\n${row()}`))
    assert.throws(() => parseEcbReferenceRatesCsv(`${header}\n${row({ OBS_VALUE: '1e3' })}`))
    assert.throws(() => parseEcbReferenceRatesCsv(`${header}\n${row({ OBS_VALUE: '0.0' })}`))
    assert.throws(() => parseEcbReferenceRatesCsv(`${header}\n${row({ TIME_PERIOD: '2026-02-30' })}`))
  })

  it('ignores other ECB series rather than treating them as daily reference rates', () => {
    assert.throws(() => parseEcbReferenceRatesCsv(`${header}\n${row({ EXR_SUFFIX: 'B' })}`))
  })
})
