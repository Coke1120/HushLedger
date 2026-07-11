export const DEFAULT_CURRENCY = 'HKD' as const

const amountPattern = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/

export const formatMoney = (minor: number, currency = DEFAULT_CURRENCY) => {
  if (!Number.isSafeInteger(minor)) throw new Error('金額超出安全範圍')

  return new Intl.NumberFormat('zh-HK', {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100)
}

export function parseAmount(value: string): number {
  const normalized = value.trim()
  const match = amountPattern.exec(normalized)
  if (!match) throw new Error('請輸入有效金額，最多兩位小數')

  const [major, fraction = ''] = normalized.split('.')
  const minor = Number(`${major}${fraction.padEnd(2, '0')}`)
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error('金額必須大於 HK$0.00')
  return minor
}
