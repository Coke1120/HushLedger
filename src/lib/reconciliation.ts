import type {
  AccountTransfer,
  AccountTransferInput,
  Transaction,
  TransactionInput,
} from './schema'

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

export function transactionInputWithClearingStatus(
  transaction: Transaction,
  cleared: boolean,
): TransactionInput {
  return {
    id: transaction.id,
    type: transaction.type,
    amountMinor: transaction.amountMinor,
    currency: transaction.currency,
    accountId: transaction.accountId,
    categoryId: transaction.categoryId,
    occurredOn: transaction.occurredOn,
    cleared,
    payee: transaction.payee,
    note: transaction.note,
  }
}

export function transferInputWithClearingStatus(
  transfer: AccountTransfer,
  accountId: number,
  cleared: boolean,
): AccountTransferInput {
  if (accountId !== transfer.fromAccountId && accountId !== transfer.toAccountId) {
    throw new Error('Transfer does not belong to the account being reconciled')
  }
  return {
    id: transfer.id,
    amountMinor: transfer.amountMinor,
    currency: transfer.currency,
    fromAccountId: transfer.fromAccountId,
    toAccountId: transfer.toAccountId,
    occurredOn: transfer.occurredOn,
    fromCleared: accountId === transfer.fromAccountId ? cleared : transfer.fromCleared,
    toCleared: accountId === transfer.toAccountId ? cleared : transfer.toCleared,
    note: transfer.note,
  }
}
