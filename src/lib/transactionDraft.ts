import { transactionInputSchema, type Transaction, type TransactionInput } from './schema'

export function duplicateTransactionDraft(
  transaction: Transaction,
  id = crypto.randomUUID(),
): TransactionInput {
  return transactionInputSchema.parse({
    id,
    type: transaction.type,
    amountMinor: transaction.amountMinor,
    currency: transaction.currency,
    accountId: transaction.accountId,
    categoryId: transaction.categoryId,
    occurredOn: transaction.occurredOn,
    cleared: false,
    payee: transaction.payee,
    note: transaction.note,
  })
}
