import type {
  Account,
  Category,
  ExpensePayeeSummary,
  PayeeSuggestion,
  TransactionType,
} from './schema'

export type RememberedPayeeReferences = {
  accountId: number | null
  categoryId: number | null
}

export function rememberPayeeReferences(
  suggestions: readonly PayeeSuggestion[],
  payee: string,
  type: TransactionType,
  accounts: readonly Account[],
  categories: readonly Category[],
  amountMinor?: number,
): RememberedPayeeReferences | null {
  const normalizedPayee = normalizePayee(payee)
  if (!normalizedPayee) return null

  const matches = suggestions.filter(
    (item) => item.type === type && normalizePayee(item.payee) === normalizedPayee,
  )
  // A repeated amount helps rank categories; it never changes the source amount.
  const suggestion = (amountMinor === undefined ? undefined
    : matches.find((item) => item.amountMinor === amountMinor)) ?? matches[0]
  if (!suggestion) return null

  const accountId = accounts.some(
    (account) => account.id === suggestion.accountId && account.isActive,
  )
    ? suggestion.accountId
    : null
  const categoryId = categories.some(
    (category) =>
      category.id === suggestion.categoryId
      && category.type === type
      && category.isActive,
  )
    ? suggestion.categoryId
    : null

  return { accountId, categoryId }
}

export function payeeOptions(
  suggestions: readonly PayeeSuggestion[],
  type: TransactionType,
) {
  return [...new Set(suggestions
    .filter((suggestion) => suggestion.type === type)
    .map((suggestion) => suggestion.payee))]
}

export function normalizePayee(payee: string) {
  return payee.trim().normalize('NFC').toLowerCase()
}

export function mergePayeeSummaries(rows: readonly ExpensePayeeSummary[]) {
  const payees = new Map<string, ExpensePayeeSummary>()

  for (const row of rows) {
    const payee = row.payee.trim().normalize('NFC')
    if (!payee) continue
    const key = normalizePayee(payee)
    const existing = payees.get(key)
    if (existing) {
      existing.amountMinor += row.amountMinor
      existing.transactionCount += row.transactionCount
      if (payee < existing.payee) existing.payee = payee
    } else {
      payees.set(key, { ...row, payee })
    }
  }

  return [...payees.values()].sort((left, right) => (
    right.amountMinor - left.amountMinor || left.payee.localeCompare(right.payee)
  ))
}
