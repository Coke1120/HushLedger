import { formatAmountInput } from './money'
import type { Transaction, TransactionType } from './schema'

export type CsvTransaction = Pick<
  Transaction,
  | 'id'
  | 'accountName'
  | 'amountMinor'
  | 'categoryName'
  | 'currency'
  | 'note'
  | 'occurredOn'
  | 'payee'
  | 'recurringRuleName'
  | 'type'
> & {
  recurrenceDueOn?: string | null
}

const headers = [
  'Date',
  'Type',
  'Amount',
  'Currency',
  'Account',
  'Category',
  'Payee',
  'Note',
  'Recurring Rule',
  'Recurring Due Date',
  'Transaction ID',
]

export function transactionsToCsv(transactions: readonly CsvTransaction[]) {
  const rows = transactions.map((transaction) => [
    transaction.occurredOn,
    transaction.type,
    signedAmount(transaction.amountMinor, transaction.type),
    transaction.currency,
    csvText(transaction.accountName),
    csvText(transaction.categoryName),
    csvText(transaction.payee),
    csvText(transaction.note),
    csvText(transaction.recurringRuleName ?? ''),
    transaction.recurrenceDueOn ?? '',
    transaction.id,
  ].join(','))

  return `\uFEFF${[headers.join(','), ...rows].join('\r\n')}\r\n`
}

function signedAmount(amountMinor: number, type: TransactionType) {
  const amount = formatAmountInput(amountMinor)
  return type === 'expense' ? `-${amount}` : amount
}

function csvText(value: string) {
  const spreadsheetSafe = /^(?:[\t\r\n]|[ \t\r\n]*[=+\-@])/.test(value) ? `'${value}` : value
  return `"${spreadsheetSafe.replaceAll('"', '""')}"`
}
