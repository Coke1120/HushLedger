import 'server-only'

import type { LedgerCurrencySettings } from '../lib/currency'
import type {
  Account,
  Category,
  Summary,
  TransactionFilterSummary,
  TransactionQuery,
} from '../lib/schema'
import { getLedgerCurrencySettings } from './ledgerSettings'
import {
  getSummary,
  listAccounts,
  listCategories,
  summarizeTransactions,
} from './money'

export type AiCopilotReadRepository = {
  getSummary(month: string): Promise<Summary>
  listAccounts(): Promise<Account[]>
  listCategories(): Promise<Category[]>
  getLedgerCurrencySettings(): Promise<LedgerCurrencySettings>
  summarizeTransactions(query: TransactionQuery): Promise<TransactionFilterSummary>
}

export function createAiCopilotReadRepository(
  database: D1Database,
): AiCopilotReadRepository {
  return {
    getSummary: (month) => getSummary(database, month),
    listAccounts: () => listAccounts(database),
    listCategories: () => listCategories(database),
    getLedgerCurrencySettings: () => getLedgerCurrencySettings(database),
    summarizeTransactions: (query) => summarizeTransactions(database, query),
  }
}
