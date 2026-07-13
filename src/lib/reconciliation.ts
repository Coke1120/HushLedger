function requireSafeInteger(value: number) {
  if (!Number.isSafeInteger(value)) {
    throw new Error('Reconciliation amount exceeds the safe integer range')
  }
  return value
}

export function calculateReconciliationDifference(
  statementBalanceMinor: number,
  clearedBalanceMinor: number,
) {
  requireSafeInteger(statementBalanceMinor)
  requireSafeInteger(clearedBalanceMinor)
  return requireSafeInteger(statementBalanceMinor - clearedBalanceMinor)
}
