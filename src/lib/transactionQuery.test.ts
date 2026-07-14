import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { transactionQueryFromFilters } from './transactionQuery'

const defaults = {
  month: '2026-07',
  scope: 'month' as const,
  dateFrom: '2026-07-01',
  dateTo: '2026-07-31',
  type: 'all' as const,
  status: 'all' as const,
  accountId: null,
  categoryId: null,
  amountMinor: null,
  payee: null,
  search: '',
  tag: null,
  duplicatesOnly: false,
  sort: 'date_desc' as const,
}

describe('transaction query request', () => {
  it('keeps the default request minimal and does not send inactive range dates', () => {
    assert.deepEqual(transactionQueryFromFilters(defaults), {
      month: '2026-07',
      scope: 'month',
    })
  })

  it('preserves every active filter in a JSON-safe request object', () => {
    assert.deepEqual(transactionQueryFromFilters({
      ...defaults,
      scope: 'range',
      type: 'expense',
      status: 'uncleared',
      importReviewStatus: 'needs_follow_up',
      accountId: 2,
      categoryId: 3,
      amountMinor: 38_640,
      payee: 'Private clinic',
      search: '  confidential note  ',
      tag: '#medical',
      duplicatesOnly: true,
      sort: 'amount_desc',
    }), {
      month: '2026-07',
      scope: 'range',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      type: 'expense',
      status: 'uncleared',
      importReviewStatus: 'needs_follow_up',
      accountId: 2,
      categoryId: 3,
      amountMinor: 38_640,
      payee: 'Private clinic',
      search: 'confidential note',
      tag: 'medical',
      duplicates: 'exact',
      sort: 'amount_desc',
    })
  })
})
