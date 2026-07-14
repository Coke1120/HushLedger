import type { DataSource } from './useMoneyData'

export function recurringRulesForLedgerSource<T>(
  ledgerSource: DataSource,
  liveRules: T[],
  fallbackRules: T[],
) {
  return ledgerSource === 'live' ? liveRules : fallbackRules
}

export function refreshRecurringRulesOnActivation(
  wasActive: boolean,
  active: boolean,
  invalidate: () => void,
  refresh: () => void,
) {
  if (active && !wasActive) {
    invalidate()
    refresh()
  }
  return active
}

export function recurringRuleReviewDataIsFresh(
  source: 'loading' | 'live' | 'demo' | 'error',
  wasActive: boolean,
  active: boolean,
) {
  return source === 'live' && !(active && !wasActive)
}
