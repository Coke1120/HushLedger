import type { DataSource } from './useMoneyData'

export function recurringRulesForLedgerSource<T>(
  ledgerSource: DataSource,
  liveRules: T[],
  fallbackRules: T[],
) {
  return ledgerSource === 'live' ? liveRules : fallbackRules
}
