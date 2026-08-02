import type { AiCopilotAction } from '../lib/aiCopilot'
import type { Account, Category } from '../lib/schema'

export function aiCopilotActionIsCurrent(
  action: AiCopilotAction,
  accounts: readonly Account[],
  categories: readonly Category[],
): boolean {
  if (action.type === 'show_transactions') {
    if (action.filters.categoryId === null) return true
    const category = categories.find((candidate) => (
      candidate.id === action.filters.categoryId && candidate.isActive
    ))
    return Boolean(
      category
      && (
        action.filters.transactionType === 'all'
        || category.type === action.filters.transactionType
      ),
    )
  }

  if (action.type !== 'draft_transaction' && action.type !== 'draft_recurring_rule') {
    return true
  }

  const account = accounts.find((candidate) => (
    candidate.id === action.input.accountId && candidate.isActive
  ))
  const category = categories.find((candidate) => (
    candidate.id === action.input.categoryId && candidate.isActive
  ))
  return Boolean(
    account
    && category
    && account.currency === action.input.currency
    && category.type === action.input.type,
  )
}
