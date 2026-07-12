import { monthRangeDates } from './date'
import type { MessageKey, Translator } from '../i18n'
import type { Account, Category, Summary, Transaction, TransactionInput, TransactionType } from './schema'

export const demoAccounts: Account[] = [
  { id: 1, name: '現金', type: 'cash', currency: 'HKD', isActive: true, sortOrder: 10, localizationKey: 'account.cash' },
  { id: 2, name: '銀行戶口', type: 'bank', currency: 'HKD', isActive: true, sortOrder: 20, localizationKey: 'account.bank' },
  { id: 3, name: '信用卡', type: 'credit_card', currency: 'HKD', isActive: true, sortOrder: 30, localizationKey: 'account.credit_card' },
  { id: 4, name: '八達通', type: 'wallet', currency: 'HKD', isActive: true, sortOrder: 40, localizationKey: 'account.wallet' },
]

export const demoCategories: Category[] = [
  { id: 1, name: '薪金', type: 'income', icon: 'banknote', color: '#147a5a', isActive: true, sortOrder: 10, localizationKey: 'category.salary' },
  { id: 2, name: '其他收入', type: 'income', icon: 'circle-dollar-sign', color: '#2f7e70', isActive: true, sortOrder: 20, localizationKey: 'category.other_income' },
  { id: 3, name: '飲食', type: 'expense', icon: 'utensils', color: '#b14b46', isActive: true, sortOrder: 10, localizationKey: 'category.food' },
  { id: 4, name: '交通', type: 'expense', icon: 'train', color: '#4b6f87', isActive: true, sortOrder: 20, localizationKey: 'category.transport' },
  { id: 5, name: '購物', type: 'expense', icon: 'shopping-bag', color: '#8c5b72', isActive: true, sortOrder: 30, localizationKey: 'category.shopping' },
  { id: 6, name: '住屋', type: 'expense', icon: 'house', color: '#8a6b42', isActive: true, sortOrder: 40, localizationKey: 'category.housing' },
  { id: 7, name: '帳單', type: 'expense', icon: 'receipt-text', color: '#73658c', isActive: true, sortOrder: 50, localizationKey: 'category.bills' },
  { id: 8, name: '娛樂', type: 'expense', icon: 'gamepad-2', color: '#9a6a38', isActive: true, sortOrder: 60, localizationKey: 'category.entertainment' },
  { id: 9, name: '醫療', type: 'expense', icon: 'heart-pulse', color: '#9f5050', isActive: true, sortOrder: 70, localizationKey: 'category.healthcare' },
  { id: 10, name: '其他支出', type: 'expense', icon: 'circle-ellipsis', color: '#64766f', isActive: true, sortOrder: 80, localizationKey: 'category.other_expense' },
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

function matchesQuery(transaction: Transaction, month: string, type: TransactionType | 'all', search: string) {
  const { start, end } = monthRangeDates(month)
  const needle = search.trim().toLowerCase()
  return (
    transaction.occurredOn >= start &&
    transaction.occurredOn < end &&
    (type === 'all' || transaction.type === type) &&
    (!needle || `${transaction.payee} ${transaction.note}`.toLowerCase().includes(needle))
  )
}

export function getDemoTransactions(
  month: string,
  type: TransactionType | 'all',
  search: string,
  t?: Translator,
) {
  return demoTransactions
    .map((transaction) => localizeDemoTransaction(transaction, t))
    .filter((transaction) => matchesQuery(transaction, month, type, search))
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

export function deleteDemo(id: string) {
  const exists = demoTransactions.some((transaction) => transaction.id === id)
  if (!exists) throw new Error('The selected demo transaction was not found')
  demoTransactions = demoTransactions.filter((transaction) => transaction.id !== id)
}

export function demoSummary(month: string): Summary {
  const rows = getDemoTransactions(month, 'all', '')
  const income = rows.reduce((sum, transaction) => sum + (transaction.type === 'income' ? transaction.amountMinor : 0), 0)
  const expense = rows.reduce((sum, transaction) => sum + (transaction.type === 'expense' ? transaction.amountMinor : 0), 0)
  return { month, income, expense, balance: income - expense }
}
