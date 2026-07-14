import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  addSavedTransactionView,
  applySavedTransactionViewsStorageChange,
  forgetSavedTransactionViews,
  MAX_SAVED_TRANSACTION_VIEWS,
  parseSavedTransactionViews,
  SAVED_TRANSACTION_VIEWS_STORAGE_KEY,
  serializeSavedTransactionViews,
  type SavedTransactionView,
} from './savedTransactionViews'

const validView: SavedTransactionView = {
  id: '248e3e55-d864-4a32-bf48-46bd3608060f',
  name: 'Uncleared card',
  scope: 'month',
  dateFrom: null,
  dateTo: null,
  type: 'expense',
  status: 'uncleared',
  importReviewStatus: 'all',
  accountId: 3,
  categoryId: null,
  payee: null,
  search: '',
  amountMinor: null,
  tag: null,
  duplicates: false,
  sort: 'date_desc',
}

describe('saved transaction views', () => {
  it('normalizes valid browser data and drops malformed or duplicate entries', () => {
    const {
      sort: legacySort,
      duplicates: legacyDuplicates,
      scope: legacyScope,
      dateFrom: legacyDateFrom,
      dateTo: legacyDateTo,
      payee: legacyPayee,
      amountMinor: legacyAmountMinor,
      ...legacyView
    } = validView
    assert.equal(legacySort, 'date_desc')
    assert.equal(legacyDuplicates, false)
    assert.equal(legacyScope, 'month')
    assert.equal(legacyDateFrom, null)
    assert.equal(legacyDateTo, null)
    assert.equal(legacyPayee, null)
    assert.equal(legacyAmountMinor, null)
    const parsed = parseSavedTransactionViews(JSON.stringify([
      { ...legacyView, name: '  Uncleared card  ' },
      { ...validView, id: '86192038-dc31-4672-ab86-d750adee2095', name: 'UNCLEARED CARD' },
      { ...validView, id: 'not-a-uuid', name: 'Broken' },
      { ...validView, id: 'c329b96d-1a1a-4108-8fbb-d3f69ced761b', name: 'Trip', tag: '#Trip' },
    ]))

    assert.deepEqual(parsed, [
      validView,
      { ...validView, id: 'c329b96d-1a1a-4108-8fbb-d3f69ced761b', name: 'Trip', tag: '#Trip' },
    ])
    assert.deepEqual(parseSavedTransactionViews('{'), [])
    assert.deepEqual(parseSavedTransactionViews(JSON.stringify({ view: validView })), [])
  })

  it('rejects duplicate names, unsafe filters, and views beyond the cap', () => {
    assert.equal(
      addSavedTransactionView([validView], {
        ...validView,
        id: '86192038-dc31-4672-ab86-d750adee2095',
        name: ' uncleared CARD ',
      }).kind,
      'duplicate',
    )
    assert.equal(addSavedTransactionView([], { ...validView, tag: '#Trip,' }).kind, 'invalid')
    assert.equal(addSavedTransactionView([], { ...validView, amountMinor: 0 }).kind, 'invalid')
    assert.equal(addSavedTransactionView([], {
      ...validView,
      amountMinor: Number.MAX_SAFE_INTEGER + 1,
    }).kind, 'invalid')
    assert.equal(addSavedTransactionView([], {
      ...validView,
      type: 'all',
      status: 'all',
      importReviewStatus: 'all',
      accountId: null,
      search: '',
    }).kind, 'invalid')
    assert.equal(addSavedTransactionView([], {
      ...validView,
      name: 'All history',
      scope: 'all',
      type: 'all',
      status: 'all',
      importReviewStatus: 'all',
      accountId: null,
      categoryId: null,
      search: '',
      tag: null,
      duplicates: false,
      sort: 'date_desc',
    }).kind, 'saved')
    assert.equal(addSavedTransactionView([], {
      ...validView,
      name: 'Largest first',
      type: 'all',
      status: 'all',
      importReviewStatus: 'all',
      accountId: null,
      categoryId: null,
      search: '',
      tag: null,
      duplicates: false,
      sort: 'amount_desc',
    }).kind, 'saved')
    assert.equal(addSavedTransactionView([], {
      ...validView,
      name: 'Possible duplicates',
      type: 'all',
      status: 'all',
      accountId: null,
      categoryId: null,
      search: '',
      tag: null,
      duplicates: true,
    }).kind, 'saved')

    const full = Array.from({ length: MAX_SAVED_TRANSACTION_VIEWS }, (_, index) => ({
      ...validView,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: `View ${index}`,
    }))
    assert.equal(addSavedTransactionView(full, {
      ...validView,
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      name: 'One too many',
    }).kind, 'limit')
    assert.equal(addSavedTransactionView([validView], { ...validView, name: 'Different name' }).kind, 'invalid')
  })

  it('keeps an exact amount filter and defaults legacy browser data to none', () => {
    const { amountMinor: legacyAmountMinor, ...legacyView } = validView
    const amountView = {
      ...validView,
      name: 'Exact charge',
      type: 'all' as const,
      status: 'all' as const,
      accountId: null,
      amountMinor: 12_345,
    }

    assert.equal(legacyAmountMinor, null)
    assert.deepEqual(parseSavedTransactionViews(JSON.stringify([legacyView])), [validView])
    assert.deepEqual(addSavedTransactionView([], amountView), {
      kind: 'saved',
      views: [amountView],
    })
  })

  it('keeps an import-review filter and defaults older browser views to all', () => {
    const { importReviewStatus: legacyImportReviewStatus, ...legacyView } = validView
    const reviewView = {
      ...validView,
      name: 'Imported to review',
      type: 'all' as const,
      status: 'all' as const,
      importReviewStatus: 'unreviewed' as const,
      accountId: null,
    }

    assert.equal(legacyImportReviewStatus, 'all')
    assert.deepEqual(parseSavedTransactionViews(JSON.stringify([legacyView])), [validView])
    assert.deepEqual(addSavedTransactionView([], reviewView), {
      kind: 'saved',
      views: [reviewView],
    })
    assert.equal(addSavedTransactionView([], {
      ...reviewView,
      importReviewStatus: 'fraud',
    }).kind, 'invalid')
  })

  it('keeps complete static ranges and rejects ambiguous saved date state', () => {
    const rangeView = {
      ...validView,
      name: 'Tax year',
      scope: 'range',
      dateFrom: '2025-04-01',
      dateTo: '2026-03-31',
    } as const

    assert.deepEqual(addSavedTransactionView([], rangeView), {
      kind: 'saved',
      views: [rangeView],
    })
    assert.equal(addSavedTransactionView([], { ...rangeView, dateTo: null }).kind, 'invalid')
    assert.equal(addSavedTransactionView([], {
      ...rangeView,
      dateFrom: '2026-04-01',
      dateTo: '2026-03-31',
    }).kind, 'invalid')
    assert.equal(addSavedTransactionView([], {
      ...validView,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    }).kind, 'invalid')
  })

  it('serializes only the bounded validated shape', () => {
    assert.deepEqual(parseSavedTransactionViews(serializeSavedTransactionViews([validView])), [validView])
  })

  it('forgets ledger-scoped views without depending on browser storage availability', () => {
    let removedKey = ''
    assert.equal(forgetSavedTransactionViews(() => ({
      removeItem(key) {
        removedKey = key
      },
    })), true)
    assert.equal(removedKey, SAVED_TRANSACTION_VIEWS_STORAGE_KEY)
    assert.equal(forgetSavedTransactionViews(() => {
      throw new Error('Storage unavailable')
    }), false)
  })

  it('synchronizes saved-view removals and replacements from other tabs', () => {
    assert.deepEqual(
      applySavedTransactionViewsStorageChange([validView], SAVED_TRANSACTION_VIEWS_STORAGE_KEY, null),
      [],
    )
    assert.deepEqual(
      applySavedTransactionViewsStorageChange([], SAVED_TRANSACTION_VIEWS_STORAGE_KEY, JSON.stringify([validView])),
      [validView],
    )
    assert.equal(
      applySavedTransactionViewsStorageChange([validView], 'unrelated', null)[0],
      validView,
    )
    assert.deepEqual(applySavedTransactionViewsStorageChange([validView], null, null), [])
  })
})
