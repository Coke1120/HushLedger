export const DEFAULT_CURRENCY = 'HKD' as const

const amountPattern = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/

export const formatMoney = (minor: number, currency: string = DEFAULT_CURRENCY, locale = 'zh-Hant') => {
  if (!Number.isSafeInteger(minor)) throw new Error('Amount exceeds the safe integer range')

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100)
}

export function formatAmountInput(minor: number, locale = 'en') {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('Amount exceeds the safe integer range')
  const separator = locale.toLowerCase().startsWith('fr') ? ',' : '.'
  return `${Math.floor(minor / 100)}${separator}${String(minor % 100).padStart(2, '0')}`
}

export function parseAmount(value: string, locale = 'en'): number {
  const normalized = locale.toLowerCase().startsWith('fr')
    ? value.trim().replace(',', '.')
    : value.trim()
  const match = amountPattern.exec(normalized)
  if (!match) throw new Error('Enter a valid amount with no more than two decimal places')

  const [major, fraction = ''] = normalized.split('.')
  const minor = Number(`${major}${fraction.padEnd(2, '0')}`)
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error('Amount must be greater than zero')
  return minor
}
