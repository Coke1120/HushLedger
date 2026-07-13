import { z } from 'zod'

export const SUPPORTED_CURRENCIES = [
  'AED',
  'AUD',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'ILS',
  'INR',
  'MOP',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'QAR',
  'SAR',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'TWD',
  'USD',
  'ZAR',
] as const

export const supportedCurrencySchema = z.enum(SUPPORTED_CURRENCIES)
export type SupportedCurrency = z.infer<typeof supportedCurrencySchema>

export const DEFAULT_LEDGER_CURRENCY: SupportedCurrency = 'HKD'

export type LedgerCurrencySettings = {
  currency: SupportedCurrency
  updatedAt: string
  canChangeCurrency: boolean
}

export function currencyDisplayName(currency: SupportedCurrency, locale: string) {
  try {
    const name = new Intl.DisplayNames(locale, { type: 'currency' }).of(currency)
    return name && name !== currency ? `${currency} — ${name}` : currency
  } catch {
    return currency
  }
}
