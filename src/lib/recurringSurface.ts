export type RecurringSurface = 'transactions' | 'transfers'

export function resolveRecurringSurface(
  preferred: RecurringSurface,
  hasTransactionRequest: boolean,
  hasTransferRequest: boolean,
): RecurringSurface {
  if (hasTransferRequest) return 'transfers'
  if (hasTransactionRequest) return 'transactions'
  return preferred
}
