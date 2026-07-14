import { evaluateAmountExpression } from './amountExpression'
import { DEFAULT_LEDGER_CURRENCY } from './currency'

export const DEFAULT_CURRENCY = DEFAULT_LEDGER_CURRENCY

const amountPattern = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/
const maximumSafeMoney = BigInt(Number.MAX_SAFE_INTEGER)

export function exactTransactionTotals(
  entries: readonly { type: 'income' | 'expense'; amountMinor: number }[],
) {
  let income = 0n
  let expense = 0n

  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amountMinor) || entry.amountMinor < 0) {
      throw new Error('Transaction amount must be a non-negative safe integer')
    }

    if (entry.type === 'income') {
      income += BigInt(entry.amountMinor)
    } else {
      expense += BigInt(entry.amountMinor)
    }
  }

  if (income > maximumSafeMoney || expense > maximumSafeMoney) {
    throw new Error('Transaction total exceeds the safe integer range')
  }

  return {
    income: Number(income),
    expense: Number(expense),
    net: Number(income - expense),
  }
}

export const formatMoney = (minor: number, currency: string = DEFAULT_CURRENCY, locale = 'zh-Hant') => {
  if (!Number.isSafeInteger(minor)) throw new Error('Amount exceeds the safe integer range')

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const exactMinor = BigInt(minor)
  const magnitudeMinor = exactMinor < 0n ? -exactMinor : exactMinor
  const magnitudeMajor = magnitudeMinor / 100n
  const fraction = formatter.formatToParts(100n + (magnitudeMinor % 100n))
    .filter((part) => part.type === 'integer')
    .map((part) => part.value)
    .join('')
    .slice(-2)
  let signedMajor: number | bigint = magnitudeMajor
  if (minor < 0 || Object.is(minor, -0)) signedMajor = magnitudeMajor === 0n ? -0 : -magnitudeMajor

  return formatter.formatToParts(signedMajor)
    .map((part) => part.type === 'fraction' ? fraction : part.value)
    .join('')
}

export function formatAmountInput(minor: number, locale = 'en') {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('Amount exceeds the safe integer range')
  const separator = locale.toLowerCase().startsWith('fr') ? ',' : '.'
  return `${Math.floor(minor / 100)}${separator}${String(minor % 100).padStart(2, '0')}`
}

export function formatSignedAmountInput(minor: number, locale = 'en') {
  if (!Number.isSafeInteger(minor)) throw new Error('Amount exceeds the safe integer range')
  const prefix = minor < 0 ? '-' : ''
  return `${prefix}${formatAmountInput(Math.abs(minor), locale)}`
}

export function resolveAmountInputLocale<Locale extends string>(
  value: string,
  locale: Locale,
  previousLocale?: Locale,
): Locale {
  if (!value.includes(',')) return locale
  if (locale.toLowerCase().startsWith('fr')) return locale
  if (previousLocale?.toLowerCase().startsWith('fr')) return previousLocale
  return locale
}

export function parseAmount(value: string, locale = 'en'): number {
  const normalized = locale.toLowerCase().startsWith('fr')
    ? value.trim().replaceAll(',', '.')
    : value.trim()
  if (/[+\-*/]/.test(normalized)) return evaluateAmountExpression(normalized)
  const match = amountPattern.exec(normalized)
  if (!match) throw new Error('Enter a valid amount with no more than two decimal places')

  const [major, fraction = ''] = normalized.split('.')
  const minor = Number(`${major}${fraction.padEnd(2, '0')}`)
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error('Amount must be greater than zero')
  return minor
}

export function parseSignedAmount(value: string, locale = 'en'): number {
  const normalized = locale.toLowerCase().startsWith('fr')
    ? value.trim().replaceAll(',', '.')
    : value.trim()
  if (!normalized) throw new Error('Enter a valid amount with no more than two decimal places')

  const negative = normalized.startsWith('-')
  const unsigned = negative ? normalized.slice(1) : normalized
  const match = amountPattern.exec(unsigned)
  if (match) {
    const [major, fraction = ''] = unsigned.split('.')
    const magnitude = Number(`${major}${fraction.padEnd(2, '0')}`)
    const minor = negative ? -magnitude : magnitude
    if (!Number.isSafeInteger(minor)) throw new Error('Amount exceeds the safe integer range')
    return minor
  }

  if (/[+\-*/]/.test(normalized)) {
    const minor = evaluateAmountExpression(normalized, true)
    if (!Number.isSafeInteger(minor)) throw new Error('Amount exceeds the safe integer range')
    return minor
  }

  throw new Error('Enter a valid amount with no more than two decimal places')
}
