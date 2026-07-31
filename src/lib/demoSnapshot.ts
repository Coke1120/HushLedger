import {
  DEFAULT_LEDGER_CURRENCY,
  type LedgerCurrencySettings,
  type SupportedCurrency,
} from './currency'
import type { AiProviderSettingsRow } from './ai'
import {
  demoAccounts,
  demoAccountBalances,
  demoCategories,
  demoNetWorthTrend,
  demoSummary,
  getDemoTransactions,
  summarizeDemoTransactions,
} from './demo'
import type {
  Account,
  AccountBalance,
  AccountRegister,
  AccountTransfer,
  Category,
  EmergencyFundGoal,
  ImportReviewStatus,
  NetWorthTrendPoint,
  Summary,
  Transaction,
  TransactionClearingStatus,
  TransactionDateScope,
  TransactionFilterSummary,
  TransactionSort,
  TransactionType,
} from './schema'

export type DemoSnapshot = {
  reportMonth: string
  transactions: Transaction[]
  accountTransfers: AccountTransfer[]
  accountBalances: AccountBalance[]
  accountRegister: AccountRegister | null
  netWorthTrend: NetWorthTrendPoint[]
  transactionFilterSummary: TransactionFilterSummary
  summary: Summary
  accounts: Account[]
  categories: Category[]
  emergencyFundGoal: EmergencyFundGoal | null
  ledgerSettings: LedgerCurrencySettings
  aiProviderSettings: AiProviderSettingsRow | null
}

export function buildDemoSnapshot(
  month: string,
  type: TransactionType | 'all',
  search: string,
  accountId: number | null,
  categoryId: number | null,
  payee: string | null,
  tag: string | null,
  status: TransactionClearingStatus | 'all',
  sort: TransactionSort,
  duplicatesOnly: boolean,
  scope: TransactionDateScope,
  dateFrom: string,
  dateTo: string,
  amountMinor: number | null = null,
  ledgerCurrency: SupportedCurrency = DEFAULT_LEDGER_CURRENCY,
  importReviewStatus: ImportReviewStatus | 'all' = 'all',
): DemoSnapshot {
  const transactions = getDemoTransactions(
    month, type, search, undefined, accountId, categoryId, tag, status, sort, duplicatesOnly, scope,
    dateFrom, dateTo, payee, ledgerCurrency, amountMinor,
    importReviewStatus,
  )

  return {
    reportMonth: month,
    transactions,
    accountTransfers: [],
    accountBalances: demoAccountBalances(month),
    accountRegister: null,
    netWorthTrend: demoNetWorthTrend(month),
    transactionFilterSummary: summarizeDemoTransactions(
      month,
      type,
      search,
      undefined,
      accountId,
      categoryId,
      tag,
      status,
      duplicatesOnly,
      scope,
      dateFrom,
      dateTo,
      payee,
      ledgerCurrency,
      amountMinor,
      importReviewStatus,
    ),
    summary: demoSummary(month),
    accounts: demoAccounts.map((account) => ({ ...account, currency: ledgerCurrency })),
    categories: demoCategories,
    emergencyFundGoal: null,
    ledgerSettings: {
      currency: ledgerCurrency,
      updatedAt: '1970-01-01T00:00:00.000Z',
      canChangeCurrency: false,
    },
    aiProviderSettings: null,
  }
}
