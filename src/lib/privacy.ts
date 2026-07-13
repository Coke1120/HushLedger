import { DEFAULT_LEDGER_CURRENCY } from './currency'
import { formatMoney } from './money'

export function shouldAutomaticallyMaskScreen(
  visibilityState: DocumentVisibilityState,
  hasFocus: boolean,
) {
  return visibilityState !== 'visible' || !hasFocus
}

export function formatPrivateMoney(currency = DEFAULT_LEDGER_CURRENCY, locale = 'zh-Hant') {
  let maskInserted = false
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .formatToParts(0)
    .map((part) => {
      if (part.type === 'integer' && !maskInserted) {
        maskInserted = true
        return '••••'
      }
      return part.type === 'currency' || part.type === 'literal' ? part.value : ''
    })
    .join('')
    .trim()
}

export function formatMoneyForDisplay(
  minor: number,
  currency = DEFAULT_LEDGER_CURRENCY,
  locale = 'zh-Hant',
  privateMode = false,
) {
  return privateMode
    ? formatPrivateMoney(currency, locale)
    : formatMoney(minor, currency, locale)
}
