import { advanceOccurrence } from './recurrence'
import {
  recurringRuleCreateSchema,
  type RecurringRuleCreateInput,
  type Transaction,
} from './schema'

export function recurringRuleDraftFromTransaction(
  transaction: Transaction,
  localizedName = '',
  id = crypto.randomUUID(),
): RecurringRuleCreateInput {
  if (transaction.recurringRuleId) {
    throw new Error('A generated recurring transaction cannot seed another recurring rule')
  }

  return recurringRuleCreateSchema.parse({
    id,
    name: localizedName.trim() || transaction.payee.trim() || transaction.categoryName,
    type: transaction.type,
    amountMinor: transaction.amountMinor,
    currency: transaction.currency,
    accountId: transaction.accountId,
    categoryId: transaction.categoryId,
    frequency: 'monthly',
    scheduleStartsOn: transaction.occurredOn,
    firstOccurrenceOn: advanceOccurrence(transaction.occurredOn, 'monthly'),
    isActive: true,
    payee: transaction.payee,
    note: transaction.note,
  })
}
