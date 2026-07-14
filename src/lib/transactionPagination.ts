import {
  TRANSACTION_PAGE_SIZE,
  transactionPageCursorSchema,
  type Transaction,
  type TransactionFilterSummary,
  type TransactionPageCursor,
} from './schema'

export type InitialTransactionPage = {
  transactions: Transaction[]
  summary: TransactionFilterSummary
  nextCursor: TransactionPageCursor | null
}

export type TransactionContinuationPage = {
  transactions: Transaction[]
  nextCursor: TransactionPageCursor | null
}

function uniqueTransactionIds(transactions: readonly Transaction[]) {
  return new Set(transactions.map(({ id }) => id)).size === transactions.length
}

function cursorMatchesTransaction(cursor: TransactionPageCursor, transaction: Transaction) {
  return transactionPageCursorSchema.safeParse(cursor).success
    && cursor.payeeBlank === (transaction.payee.trim() === '' ? 1 : 0)
    && cursor.id === transaction.id
    && cursor.amountMinor === transaction.amountMinor
    && cursor.occurredOn === transaction.occurredOn
    && cursor.payee === transaction.payee
    && cursor.createdAt === transaction.createdAt
}

export function isValidInitialTransactionPage(page: InitialTransactionPage) {
  const total = page.summary.transactionCount
  if (!Number.isSafeInteger(total) || total < 0) return false
  if (page.transactions.length > TRANSACTION_PAGE_SIZE) return false
  if (!uniqueTransactionIds(page.transactions)) return false

  if (page.nextCursor) {
    const last = page.transactions.at(-1)
    return page.transactions.length === TRANSACTION_PAGE_SIZE
      && page.transactions.length < total
      && last !== undefined
      && cursorMatchesTransaction(page.nextCursor, last)
  }
  return page.transactions.length === total
}

export type MergeTransactionPageResult =
  | {
    kind: 'merged'
    transactions: Transaction[]
    nextCursor: TransactionPageCursor | null
  }
  | { kind: 'invalid' }

export function mergeTransactionContinuation(
  current: readonly Transaction[],
  total: number,
  cursor: TransactionPageCursor,
  page: TransactionContinuationPage,
): MergeTransactionPageResult {
  if (!Number.isSafeInteger(total) || total < 1 || current.length >= total) return { kind: 'invalid' }
  const currentLast = current.at(-1)
  if (!currentLast || !cursorMatchesTransaction(cursor, currentLast)) return { kind: 'invalid' }
  if (page.transactions.length < 1 || page.transactions.length > TRANSACTION_PAGE_SIZE) {
    return { kind: 'invalid' }
  }
  if (!uniqueTransactionIds(page.transactions)) return { kind: 'invalid' }

  const currentIds = new Set(current.map(({ id }) => id))
  if (page.transactions.some(({ id }) => currentIds.has(id))) return { kind: 'invalid' }
  const transactions = [...current, ...page.transactions]
  if (transactions.length > total) return { kind: 'invalid' }

  if (page.nextCursor) {
    const last = page.transactions.at(-1)
    if (
      page.transactions.length !== TRANSACTION_PAGE_SIZE
      || transactions.length >= total
      || page.nextCursor.version !== cursor.version
      || page.nextCursor.revision !== cursor.revision
      || page.nextCursor.queryKey !== cursor.queryKey
      || page.nextCursor.sort !== cursor.sort
      || !last
      || !cursorMatchesTransaction(page.nextCursor, last)
    ) return { kind: 'invalid' }
  } else if (transactions.length !== total) {
    return { kind: 'invalid' }
  }

  return { kind: 'merged', transactions, nextCursor: page.nextCursor }
}
