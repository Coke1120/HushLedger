import type { Account, Category, PayeeSuggestion, TransactionType } from './schema'

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
): RememberedPayeeReferences | null {
  const normalizedPayee = normalizePayee(payee)
  if (!normalizedPayee) return null

  const suggestion = suggestions.find(
    (item) => item.type === type && normalizePayee(item.payee) === normalizedPayee,
  )
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
  return suggestions
    .filter((suggestion) => suggestion.type === type)
    .map((suggestion) => suggestion.payee)
}

function normalizePayee(payee: string) {
  return payee.trim().toLowerCase()
}
