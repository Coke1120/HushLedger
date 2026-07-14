import type { DataSource } from '../hooks/useMoneyData'
import type { RecurringTransferRule } from '../lib/schema'

export function visibleRecurringTransferRules(
  ledgerSource: DataSource,
  rules: RecurringTransferRule[],
) {
  return ledgerSource === 'live' ? rules : []
}
