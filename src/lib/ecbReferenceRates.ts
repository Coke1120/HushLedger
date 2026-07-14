import { supportedCurrencySchema, type SupportedCurrency } from './currency'
import { isValidCalendarDate } from './date'
import { parseCsvRecords } from './csvImport'

export const ECB_REFERENCE_RATE_SOURCE = 'ecb' as const
export const ECB_REFERENCE_RATE_BASE_CURRENCY = 'EUR' as const

export type EcbReferenceRate = {
  quoteCurrency: SupportedCurrency
  rate: string
  observedOn: string
}

const requiredColumns = [
  'FREQ',
  'CURRENCY',
  'CURRENCY_DENOM',
  'EXR_TYPE',
  'EXR_SUFFIX',
  'TIME_PERIOD',
  'OBS_VALUE',
  'OBS_STATUS',
] as const

const decimalRate = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,12})?$/

/**
 * Parses only the daily ECB EUR-base reference-rate series requested by this
 * feature. Values remain decimal text so a reference source cannot silently
 * introduce floating-point rounding into the ledger.
 */
export function parseEcbReferenceRatesCsv(csv: string): EcbReferenceRate[] {
  const records = parseCsvRecords(csv)
  const [header, ...rows] = records
  if (!header || rows.length === 0) throw new Error('ECB response has no data rows')

  const columns = new Map<string, number>()
  header.forEach((value, index) => {
    const name = (index === 0 ? value.replace(/^\uFEFF/, '') : value).trim()
    if (name.length === 0 || columns.has(name)) throw new Error('ECB response has invalid columns')
    columns.set(name, index)
  })
  if (requiredColumns.some((column) => !columns.has(column))) {
    throw new Error('ECB response is missing required columns')
  }

  const rates = new Map<SupportedCurrency, EcbReferenceRate>()
  for (const row of rows) {
    if (row.every((value) => value.trim() === '')) continue
    if (row.length !== header.length) throw new Error('ECB response has an invalid data row')

    const value = (column: (typeof requiredColumns)[number]) => row[columns.get(column)!]!.trim()
    if (
      value('FREQ') !== 'D'
      || value('CURRENCY_DENOM') !== ECB_REFERENCE_RATE_BASE_CURRENCY
      || value('EXR_TYPE') !== 'SP00'
      || value('EXR_SUFFIX') !== 'A'
      || value('OBS_STATUS') !== 'A'
    ) continue

    const quote = supportedCurrencySchema.safeParse(value('CURRENCY'))
    if (!quote.success || quote.data === ECB_REFERENCE_RATE_BASE_CURRENCY) continue
    const rate = value('OBS_VALUE')
    const observedOn = value('TIME_PERIOD')
    if (
      !decimalRate.test(rate)
      || /^0(?:\.0+)?$/.test(rate)
      || !isValidCalendarDate(observedOn)
    ) {
      throw new Error('ECB response contains an invalid reference rate')
    }
    if (rates.has(quote.data)) throw new Error('ECB response contains duplicate reference rates')
    rates.set(quote.data, { quoteCurrency: quote.data, rate, observedOn })
  }

  if (rates.size === 0) throw new Error('ECB response has no supported daily reference rates')
  return [...rates.values()].sort((left, right) => left.quoteCurrency.localeCompare(right.quoteCurrency))
}
