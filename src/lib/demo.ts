import { monthRangeDates } from './date'
import { buildMonthlySpendingTrend } from './spendingTrend'
import { buildNetWorthTrend, netWorthTrendMonths } from './netWorthTrend'
import { mergePayeeSummaries, normalizePayee } from './payeeMemory'
import { noteHasTransactionTag } from './transactionTags'
import { supportedLocales, translate, type MessageKey, type Translator } from '../i18n'
import type {
  Account,
  AccountBalance,
  NetWorthTrendPoint,
  Category,
  ExpenseCategorySummary,
  MonthlySpendingSummary,
  Summary,
  Transaction,
  TransactionCategoryBatchInput,
  TransactionClearingBatchInput,
  TransactionClearingStatus,
  TransactionDateScope,
  TransactionFilterSummary,
  TransactionInput,
  TransactionSort,
  TransactionType,
} from './schema'

export const demoAccounts: Account[] = [
  { id: 1, name: '現金', type: 'cash', currency: 'HKD', isActive: true, sortOrder: 10, localizationKey: 'account.cash', openingBalanceMinor: null, openingBalanceOn: null, updatedAt: '2026-07-11T10:30:00.000Z' },
  { id: 2, name: '銀行戶口', type: 'bank', currency: 'HKD', isActive: true, sortOrder: 20, localizationKey: 'account.bank', openingBalanceMinor: null, openingBalanceOn: null, updatedAt: '2026-07-11T10:30:00.000Z' },
  { id: 3, name: '信用卡', type: 'credit_card', currency: 'HKD', isActive: true, sortOrder: 30, localizationKey: 'account.credit_card', openingBalanceMinor: null, openingBalanceOn: null, updatedAt: '2026-07-11T10:30:00.000Z' },
  { id: 4, name: '八達通', type: 'wallet', currency: 'HKD', isActive: true, sortOrder: 40, localizationKey: 'account.wallet', openingBalanceMinor: null, openingBalanceOn: null, updatedAt: '2026-07-11T10:30:00.000Z' },
]

export const demoCategories: Category[] = [
  { id: 1, name: '薪金', type: 'income', icon: 'banknote', color: '#147a5a', isActive: true, sortOrder: 10, localizationKey: 'category.salary', monthlyPlanMinor: null, updatedAt: '2026-07-11T10:30:00.000Z' },
  { id: 2, name: '其他收入', type: 'income', icon: 'circle-dollar-sign', color: '#2f7e70', isActive: true, sortOrder: 20, localizationKey: 'category.other_income', monthlyPlanMinor: null, updatedAt: '2026-07-11T10:30:00.000Z' },
  { id: 3, name: '飲食', type: 'expense', icon: 'utensils', color: '#b14b46', isActive: true, sortOrder: 10, localizationKey: 'category.food', monthlyPlanMinor: 50_000, updatedAt: '2026-07-11T10:30:00.000Z' },
  { id: 4, name: '交通', type: 'expense', icon: 'train', color: '#4b6f87', isActive: true, sortOrder: 20, localizationKey: 'category.transport', monthlyPlanMinor: null, updatedAt: '2026-07-11T10:30:00.000Z' },
  { id: 5, name: '購物', type: 'expense', icon: 'shopping-bag', color: '#8c5b72', isActive: true, sortOrder: 30, localizationKey: 'category.shopping', monthlyPlanMinor: null, updatedAt: '2026-07-11T10:30:00.000Z' },
  { id: 6, name: '住屋', type: 'expense', icon: 'house', color: '#8a6b42', isActive: true, sortOrder: 40, localizationKey: 'category.housing', monthlyPlanMinor: 1_500_000, updatedAt: '2026-07-11T10:30:00.000Z' },
  { id: 7, name: '帳單', type: 'expense', icon: 'receipt-text', color: '#73658c', isActive: true, sortOrder: 50, localizationKey: 'category.bills', monthlyPlanMinor: 120_000, updatedAt: '2026-07-11T10:30:00.000Z' },
  { id: 8, name: '娛樂', type: 'expense', icon: 'gamepad-2', color: '#9a6a38', isActive: true, sortOrder: 60, localizationKey: 'category.entertainment', monthlyPlanMinor: null, updatedAt: '2026-07-11T10:30:00.000Z' },
  { id: 9, name: '醫療', type: 'expense', icon: 'heart-pulse', color: '#9f5050', isActive: true, sortOrder: 70, localizationKey: 'category.healthcare', monthlyPlanMinor: null, updatedAt: '2026-07-11T10:30:00.000Z' },
  { id: 10, name: '其他支出', type: 'expense', icon: 'circle-ellipsis', color: '#64766f', isActive: true, sortOrder: 80, localizationKey: 'category.other_expense', monthlyPlanMinor: null, updatedAt: '2026-07-11T10:30:00.000Z' },
]

const createdAt = '2026-07-11T10:30:00.000Z'

export let demoTransactions: Transaction[] = [
  {
    id: '248e3e55-d864-4a32-bf48-46bd3608060f',
    type: 'expense',
    amountMinor: 38_640,
    currency: 'HKD',
    accountId: 3,
    categoryId: 3,
    occurredOn: '2026-07-11',
    cleared: false,
    payee: '百佳超級市場',
    note: '日常雜貨',
    accountName: '信用卡',
    accountLocalizationKey: 'account.credit_card',
    categoryName: '飲食',
    categoryLocalizationKey: 'category.food',
    categoryIcon: 'utensils',
    categoryColor: '#b14b46',
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: '86192038-dc31-4672-ab86-d750adee2095',
    type: 'expense',
    amountMinor: 4_210,
    currency: 'HKD',
    accountId: 4,
    categoryId: 4,
    occurredOn: '2026-07-10',
    cleared: true,
    payee: '港鐵',
    note: '',
    accountName: '八達通',
    accountLocalizationKey: 'account.wallet',
    categoryName: '交通',
    categoryLocalizationKey: 'category.transport',
    categoryIcon: 'train',
    categoryColor: '#4b6f87',
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: 'c329b96d-1a1a-4108-8fbb-d3f69ced761b',
    type: 'expense',
    amountMinor: 6_800,
    currency: 'HKD',
    accountId: 1,
    categoryId: 3,
    occurredOn: '2026-07-09',
    cleared: true,
    payee: '午餐',
    note: '',
    accountName: '現金',
    accountLocalizationKey: 'account.cash',
    categoryName: '飲食',
    categoryLocalizationKey: 'category.food',
    categoryIcon: 'utensils',
    categoryColor: '#b14b46',
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: 'ad301dea-caf6-477a-995c-a746b24f2100',
    type: 'expense',
    amountMinor: 19_800,
    currency: 'HKD',
    accountId: 2,
    categoryId: 7,
    occurredOn: '2026-07-08',
    cleared: true,
    payee: '電訊月費',
    note: '',
    accountName: '銀行戶口',
    accountLocalizationKey: 'account.bank',
    categoryName: '帳單',
    categoryLocalizationKey: 'category.bills',
    categoryIcon: 'receipt-text',
    categoryColor: '#73658c',
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: '60c1a538-2a10-48b9-8d59-d02bd012b834',
    type: 'expense',
    amountMinor: 98_500,
    currency: 'HKD',
    accountId: 2,
    categoryId: 7,
    occurredOn: '2026-07-05',
    cleared: true,
    payee: '水電煤',
    note: '',
    accountName: '銀行戶口',
    accountLocalizationKey: 'account.bank',
    categoryName: '帳單',
    categoryLocalizationKey: 'category.bills',
    categoryIcon: 'receipt-text',
    categoryColor: '#73658c',
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: '7598bb40-b9ac-4cf9-b81e-d0a0f8f9334f',
    type: 'expense',
    amountMinor: 1_550_000,
    currency: 'HKD',
    accountId: 2,
    categoryId: 6,
    occurredOn: '2026-07-03',
    cleared: true,
    payee: '每月租金',
    note: '',
    accountName: '銀行戶口',
    accountLocalizationKey: 'account.bank',
    categoryName: '住屋',
    categoryLocalizationKey: 'category.housing',
    categoryIcon: 'house',
    categoryColor: '#8a6b42',
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: '092ed4e3-29f7-40b1-a917-84d102ebbc1f',
    type: 'income',
    amountMinor: 5_200_000,
    currency: 'HKD',
    accountId: 2,
    categoryId: 1,
    occurredOn: '2026-07-01',
    cleared: true,
    payee: '本月薪金',
    note: '',
    accountName: '銀行戶口',
    accountLocalizationKey: 'account.bank',
    categoryName: '薪金',
    categoryLocalizationKey: 'category.salary',
    categoryIcon: 'banknote',
    categoryColor: '#147a5a',
    createdAt,
    updatedAt: createdAt,
  },
]

export function demoAccountBalances(month: string): AccountBalance[] {
  const { end } = monthRangeDates(month)
  return demoAccounts.map((account) => {
    const movements = demoTransactions.filter((transaction) => (
      transaction.accountId === account.id && transaction.occurredOn < end
    ))
    const recordedBalance = movements.reduce(
      (total, transaction) => total + (transaction.type === 'income' ? transaction.amountMinor : -transaction.amountMinor),
      0,
    )
    const clearedBalance = movements.reduce(
      (total, transaction) => transaction.cleared
        ? total + (transaction.type === 'income' ? transaction.amountMinor : -transaction.amountMinor)
        : total,
      0,
    )
    return {
      accountId: account.id,
      accountName: account.name,
      accountLocalizationKey: account.localizationKey,
      accountType: account.type,
      isActive: account.isActive,
      openingBalanceMinor: null,
      openingBalanceOn: null,
      recordedBalance,
      clearedBalance,
      unclearedBalance: recordedBalance - clearedBalance,
    }
  })
}

export function demoNetWorthTrend(month: string): NetWorthTrendPoint[] {
  return buildNetWorthTrend(
    month,
    new Map(netWorthTrendMonths(month).map((trendMonth) => (
      [trendMonth, demoAccountBalances(trendMonth)]
    ))),
  )
}

const demoTransactionCopy: Readonly<
  Record<string, { payee: MessageKey; note?: MessageKey }>
> = {
  '248e3e55-d864-4a32-bf48-46bd3608060f': {
    payee: 'demoPayeeGroceries',
    note: 'demoNoteGroceries',
  },
  '86192038-dc31-4672-ab86-d750adee2095': { payee: 'demoPayeeTransit' },
  'c329b96d-1a1a-4108-8fbb-d3f69ced761b': { payee: 'demoPayeeLunch' },
  'ad301dea-caf6-477a-995c-a746b24f2100': { payee: 'demoPayeeTelecom' },
  '60c1a538-2a10-48b9-8d59-d02bd012b834': { payee: 'demoPayeeUtilities' },
  '7598bb40-b9ac-4cf9-b81e-d0a0f8f9334f': { payee: 'demoPayeeRent' },
  '092ed4e3-29f7-40b1-a917-84d102ebbc1f': { payee: 'demoPayeeSalary' },
}
const editedDemoTransactionIds = new Set<string>()

function localizeDemoTransaction(transaction: Transaction, t?: Translator): Transaction {
  const copy = demoTransactionCopy[transaction.id]
  if (!copy || !t || editedDemoTransactionIds.has(transaction.id)) return transaction
  return {
    ...transaction,
    payee: t(copy.payee),
    note: copy.note ? t(copy.note) : transaction.note,
  }
}

function matchesDemoPayee(transaction: Transaction, payee: string | null) {
  if (payee === null) return true
  const exactPayee = normalizePayee(payee)
  if (normalizePayee(transaction.payee) === exactPayee) return true

  const copy = demoTransactionCopy[transaction.id]
  return Boolean(
    copy
    && !editedDemoTransactionIds.has(transaction.id)
    && supportedLocales.some((locale) => normalizePayee(translate(locale, copy.payee)) === exactPayee),
  )
}

function matchesQuery(
  transaction: Transaction,
  month: string,
  type: TransactionType | 'all',
  search: string,
  accountId: number | null,
  categoryId: number | null,
  tag: string | null,
  status: TransactionClearingStatus | 'all',
  scope: TransactionDateScope,
  dateFrom: string | null,
  dateTo: string | null,
  payee: string | null,
) {
  const monthRange = scope === 'month' ? monthRangeDates(month) : null
  const matchesDate = monthRange
    ? transaction.occurredOn >= monthRange.start && transaction.occurredOn < monthRange.end
    : scope === 'range'
      ? dateFrom !== null
        && dateTo !== null
        && transaction.occurredOn >= dateFrom
        && transaction.occurredOn <= dateTo
      : true
  const needle = search.trim().toLowerCase()
  return (
    matchesDate &&
    (type === 'all' || transaction.type === type) &&
    (accountId === null || transaction.accountId === accountId) &&
    (categoryId === null || transaction.categoryId === categoryId) &&
    matchesDemoPayee(transaction, payee) &&
    (status === 'all' || transaction.cleared === (status === 'cleared')) &&
    (tag === null || noteHasTransactionTag(transaction.note, tag)) &&
    (!needle || `${transaction.payee} ${transaction.note}`.toLowerCase().includes(needle))
  )
}

function hasExactDuplicate(transaction: Transaction, transactions: Transaction[]) {
  return transactions.some((candidate) => (
    candidate.id !== transaction.id
    && candidate.type === transaction.type
    && candidate.amountMinor === transaction.amountMinor
    && candidate.currency === transaction.currency
    && candidate.accountId === transaction.accountId
    && candidate.categoryId === transaction.categoryId
    && candidate.occurredOn === transaction.occurredOn
    && candidate.payee === transaction.payee
    && candidate.note === transaction.note
  ))
}

export function getDemoTransactions(
  month: string,
  type: TransactionType | 'all',
  search: string,
  t?: Translator,
  accountId: number | null = null,
  categoryId: number | null = null,
  tag: string | null = null,
  status: TransactionClearingStatus | 'all' = 'all',
  sort: TransactionSort = 'date_desc',
  duplicatesOnly = false,
  scope: TransactionDateScope = 'month',
  dateFrom: string | null = null,
  dateTo: string | null = null,
  payee: string | null = null,
) {
  const localized = demoTransactions.map((transaction) => localizeDemoTransaction(transaction, t))
  return localized
    .filter((transaction) => matchesQuery(
      transaction, month, type, search, accountId, categoryId, tag, status, scope, dateFrom, dateTo,
      payee,
    ))
    .filter((transaction) => !duplicatesOnly || hasExactDuplicate(transaction, localized))
    .sort((left, right) => compareDemoTransactions(left, right, sort))
}

function compareDemoTransactions(left: Transaction, right: Transaction, sort: TransactionSort) {
  const dateDescending = right.occurredOn.localeCompare(left.occurredOn)
    || right.createdAt.localeCompare(left.createdAt)
    || right.id.localeCompare(left.id)
  if (sort === 'date_desc') return dateDescending
  if (sort === 'date_asc') {
    return left.occurredOn.localeCompare(right.occurredOn)
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
  }
  if (sort === 'amount_desc') return right.amountMinor - left.amountMinor || dateDescending
  if (sort === 'amount_asc') return left.amountMinor - right.amountMinor || dateDescending

  const leftPayee = left.payee.trim()
  const rightPayee = right.payee.trim()
  if (!leftPayee && rightPayee) return 1
  if (leftPayee && !rightPayee) return -1
  const payeeOrder = leftPayee.localeCompare(rightPayee, undefined, { sensitivity: 'base' })
  return (sort === 'payee_asc' ? payeeOrder : -payeeOrder) || dateDescending
}

export function summarizeDemoTransactions(
  month: string,
  type: TransactionType | 'all',
  search: string,
  t?: Translator,
  accountId: number | null = null,
  categoryId: number | null = null,
  tag: string | null = null,
  status: TransactionClearingStatus | 'all' = 'all',
  duplicatesOnly = false,
  scope: TransactionDateScope = 'month',
  dateFrom: string | null = null,
  dateTo: string | null = null,
  payee: string | null = null,
): TransactionFilterSummary {
  const rows = getDemoTransactions(
    month,
    type,
    search,
    t,
    accountId,
    categoryId,
    tag,
    status,
    'date_desc',
    duplicatesOnly,
    scope,
    dateFrom,
    dateTo,
    payee,
  )
  const income = rows.reduce(
    (sum, transaction) => sum + (transaction.type === 'income' ? transaction.amountMinor : 0),
    0,
  )
  const expense = rows.reduce(
    (sum, transaction) => sum + (transaction.type === 'expense' ? transaction.amountMinor : 0),
    0,
  )
  return { transactionCount: rows.length, income, expense, net: income - expense }
}

export function addDemo(input: TransactionInput) {
  const account = demoAccounts.find((item) => item.id === input.accountId)
  const category = demoCategories.find((item) => item.id === input.categoryId)
  if (!account || !category) throw new Error('The selected demo account or category was not found')

  const timestamp = new Date().toISOString()
  const transaction: Transaction = {
    ...input,
    accountName: account.name,
    accountLocalizationKey: account.localizationKey,
    categoryName: category.name,
    categoryLocalizationKey: category.localizationKey,
    categoryIcon: category.icon,
    categoryColor: category.color,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  demoTransactions = [transaction, ...demoTransactions]
  return transaction
}

export function updateDemo(input: TransactionInput) {
  const existing = demoTransactions.find((transaction) => transaction.id === input.id)
  const account = demoAccounts.find((item) => item.id === input.accountId)
  const category = demoCategories.find((item) => item.id === input.categoryId)
  if (!existing || !account || !category) throw new Error('The selected demo transaction was not found')

  const transaction: Transaction = {
    ...existing,
    ...input,
    accountName: account.name,
    accountLocalizationKey: account.localizationKey,
    categoryName: category.name,
    categoryLocalizationKey: category.localizationKey,
    categoryIcon: category.icon,
    categoryColor: category.color,
    updatedAt: new Date().toISOString(),
  }
  editedDemoTransactionIds.add(input.id)
  demoTransactions = demoTransactions.map((item) => item.id === input.id ? transaction : item)
  return transaction
}

export function setDemoTransactionsClearing(input: TransactionClearingBatchInput) {
  const currentById = new Map(demoTransactions.map((transaction) => [transaction.id, transaction]))
  const allCurrent = input.transactions.every(({ id, updatedAt }) => (
    currentById.get(id)?.updatedAt === updatedAt
  ))
  if (!allCurrent) return { kind: 'version_conflict' as const }

  const selectedIds = new Set(input.transactions.map(({ id }) => id))
  const updatedAt = new Date().toISOString()
  demoTransactions = demoTransactions.map((transaction) => (
    selectedIds.has(transaction.id)
      ? { ...transaction, cleared: input.cleared, updatedAt }
      : transaction
  ))
  return { kind: 'updated' as const, count: input.transactions.length }
}

export function setDemoTransactionsCategory(input: TransactionCategoryBatchInput) {
  const category = demoCategories.find(({ id, isActive }) => id === input.categoryId && isActive)
  if (!category) return { kind: 'reference_invalid' as const, code: 'CATEGORY_INVALID' as const }

  const currentById = new Map(demoTransactions.map((transaction) => [transaction.id, transaction]))
  const selected = input.transactions.map(({ id, updatedAt }) => {
    const transaction = currentById.get(id)
    return transaction?.updatedAt === updatedAt ? transaction : null
  })
  if (selected.some((transaction) => transaction === null)) {
    return { kind: 'version_conflict' as const }
  }
  if (selected.some((transaction) => transaction?.type !== category.type)) {
    return { kind: 'reference_invalid' as const, code: 'CATEGORY_TYPE_MISMATCH' as const }
  }

  const selectedIds = new Set(input.transactions.map(({ id }) => id))
  const updatedAt = new Date().toISOString()
  demoTransactions = demoTransactions.map((transaction) => (
    selectedIds.has(transaction.id)
      ? {
          ...transaction,
          categoryId: category.id,
          categoryName: category.name,
          categoryLocalizationKey: category.localizationKey,
          categoryIcon: category.icon,
          categoryColor: category.color,
          updatedAt,
        }
      : transaction
  ))
  return { kind: 'updated' as const, count: input.transactions.length }
}

export function deleteDemo(id: string) {
  const exists = demoTransactions.some((transaction) => transaction.id === id)
  if (!exists) throw new Error('The selected demo transaction was not found')
  demoTransactions = demoTransactions.filter((transaction) => transaction.id !== id)
}

export function demoSummary(month: string, t?: Translator): Summary {
  const rows = getDemoTransactions(month, 'all', '', t)
  const income = rows.reduce((sum, transaction) => sum + (transaction.type === 'income' ? transaction.amountMinor : 0), 0)
  const expense = rows.reduce((sum, transaction) => sum + (transaction.type === 'expense' ? transaction.amountMinor : 0), 0)
  const expenseByCategory = [...rows.reduce((categories, transaction) => {
    if (transaction.type !== 'expense') return categories
    const existing = categories.get(transaction.categoryId)
    if (existing) {
      existing.amountMinor += transaction.amountMinor
      existing.transactionCount += 1
      return categories
    }

    categories.set(transaction.categoryId, {
      categoryId: transaction.categoryId,
      categoryName: transaction.categoryName,
      categoryLocalizationKey: transaction.categoryLocalizationKey,
      categoryIcon: transaction.categoryIcon,
      categoryColor: transaction.categoryColor,
      amountMinor: transaction.amountMinor,
      transactionCount: 1,
    })
    return categories
  }, new Map<number, ExpenseCategorySummary>()).values()]
    .sort((left, right) => right.amountMinor - left.amountMinor || left.categoryId - right.categoryId)
  const expenseByPayee = mergePayeeSummaries(rows
    .filter((transaction) => transaction.type === 'expense')
    .map((transaction) => ({
      payee: transaction.payee,
      amountMinor: transaction.amountMinor,
      transactionCount: 1,
    })))
  const spendingTrendRows = [...demoTransactions.reduce((months, transaction) => {
    if (transaction.type !== 'expense') return months
    const transactionMonth = transaction.occurredOn.slice(0, 7)
    const existing = months.get(transactionMonth)
    if (existing) {
      existing.amountMinor += transaction.amountMinor
      existing.transactionCount += 1
      return months
    }
    months.set(transactionMonth, {
      month: transactionMonth,
      amountMinor: transaction.amountMinor,
      transactionCount: 1,
    })
    return months
  }, new Map<string, MonthlySpendingSummary>()).values()]
  return {
    month,
    income,
    expense,
    balance: income - expense,
    spendingTrend: buildMonthlySpendingTrend(month, spendingTrendRows),
    expenseByCategory,
    expenseByPayee,
    monthlySpendingPlans: demoCategories
      .filter((category) => category.isActive && category.monthlyPlanMinor !== null)
      .map((category) => ({
        categoryId: category.id,
        categoryName: category.name,
        categoryLocalizationKey: category.localizationKey,
        categoryIcon: category.icon,
        categoryColor: category.color,
        plannedMinor: category.monthlyPlanMinor ?? 0,
        spentMinor: expenseByCategory.find(({ categoryId }) => categoryId === category.id)?.amountMinor ?? 0,
      })),
    recurringForecast: [],
  }
}
