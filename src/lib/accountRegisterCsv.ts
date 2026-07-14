import { csvText } from './csv'
import type { SupportedCurrency } from './currency'
import { formatSignedAmountInput } from './money'
import type { AccountRegister } from './schema'

const headers = [
  'Date',
  'Entry Kind',
  'Amount',
  'Currency',
  'Cleared',
  'Running Balance',
  'Account',
  'Account ID',
  'Category',
  'Payee',
  'Counterparty Account',
  'Transfer Direction',
  'Note',
  'Entry ID',
  'Source ID',
]

export function accountRegisterToCsv(
  register: AccountRegister,
  currency: SupportedCurrency,
) {
  const rows = [...register.entries].reverse().map((entry) => [
    entry.occurredOn,
    entry.kind,
    formatSignedAmountInput(entry.amountMinor),
    currency,
    entry.cleared === null ? '' : entry.cleared ? 'Cleared' : 'Uncleared',
    formatSignedAmountInput(entry.runningBalanceMinor),
    csvText(register.accountName),
    register.accountId,
    csvText(entry.categoryName ?? ''),
    csvText(entry.payee),
    csvText(entry.counterpartyAccountName ?? ''),
    entry.transferDirection ?? '',
    csvText(entry.note),
    entry.entryId,
    entry.sourceId ?? '',
  ].join(','))

  if (register.startingBalanceMinor !== null) {
    rows.unshift([
      register.dateFrom,
      'range_start',
      '',
      currency,
      '',
      formatSignedAmountInput(register.startingBalanceMinor),
      csvText(register.accountName),
      register.accountId,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ].join(','))
  }

  return `\uFEFF${[headers.join(','), ...rows].join('\r\n')}\r\n`
}
