import type {
  TransactionClearingStatus,
  TransactionDateScope,
  TransactionQuery,
  TransactionSort,
  TransactionType,
} from './schema'

export type TransactionQueryFilters = {
  month: string
  scope: TransactionDateScope
  dateFrom: string
  dateTo: string
  type: TransactionType | 'all'
  status: TransactionClearingStatus | 'all'
  accountId: number | null
  categoryId: number | null
  amountMinor: number | null
  payee: string | null
  search: string
  tag: string | null
  duplicatesOnly: boolean
  sort: TransactionSort
}

export function transactionQueryFromFilters({
  month,
  scope,
  dateFrom,
  dateTo,
  type,
  status,
  accountId,
  categoryId,
  amountMinor,
  payee,
  search,
  tag,
  duplicatesOnly,
  sort,
}: TransactionQueryFilters): TransactionQuery {
  const query: TransactionQuery = { month, scope }
  if (scope === 'range') {
    query.dateFrom = dateFrom
    query.dateTo = dateTo
  }
  if (type !== 'all') query.type = type
  if (status !== 'all') query.status = status
  if (accountId !== null) query.accountId = accountId
  if (categoryId !== null) query.categoryId = categoryId
  if (amountMinor !== null) query.amountMinor = amountMinor
  if (payee !== null) query.payee = payee
  if (search.trim()) query.search = search.trim()
  if (tag) query.tag = tag.slice(1)
  if (duplicatesOnly) query.duplicates = 'exact'
  if (sort !== 'date_desc') query.sort = sort
  return query
}
