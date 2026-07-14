import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  accountUnclearedReviewContext,
  accountUnclearedReviewIsCurrent,
  parseAccountUnclearedReview,
} from './accountRegisterReview'

const entry = {
  entryId: 'transaction:txn-1',
  sourceId: 'txn-1',
  kind: 'transaction',
  occurredOn: '2026-06-01',
  amountMinor: -1250,
  runningBalanceMinor: 98_750,
  cleared: false,
  updatedAt: '2026-07-14T08:00:00.000Z',
  payee: 'Grocer',
  note: '',
  categoryName: 'Food',
  categoryLocalizationKey: null,
  counterpartyAccountName: null,
  counterpartyAccountLocalizationKey: null,
  transferDirection: null,
} as const

const review = {
  complete: true,
  accountId: 7,
  accountName: 'Bank',
  accountLocalizationKey: null,
  dateTo: '2026-07-12',
  availableFrom: '2025-01-01',
  endingBalanceMinor: 98_750,
  clearedEndingBalanceMinor: 100_000,
  unclearedEndingBalanceMinor: -1250,
  unclearedCount: 1,
  entries: [entry],
} as const

describe('complete uncleared account review', () => {
  it('accepts only a complete response for the active account and cutoff', () => {
    assert.deepEqual(
      parseAccountUnclearedReview(review, { accountId: 7, dateTo: '2026-07-12' }),
      review,
    )
    assert.equal(
      parseAccountUnclearedReview(review, { accountId: 8, dateTo: '2026-07-12' }),
      null,
    )
    assert.equal(
      parseAccountUnclearedReview(review, { accountId: 7, dateTo: '2026-07-13' }),
      null,
    )
  })

  it('fails closed for partial, duplicate, cleared, or future entries', () => {
    assert.equal(parseAccountUnclearedReview(
      { ...review, unclearedCount: 2 },
      { accountId: 7, dateTo: '2026-07-12' },
    ), null)
    assert.equal(parseAccountUnclearedReview(
      { ...review, unclearedCount: 2, entries: [entry, entry] },
      { accountId: 7, dateTo: '2026-07-12' },
    ), null)
    assert.equal(parseAccountUnclearedReview(
      { ...review, entries: [{ ...entry, cleared: true }] },
      { accountId: 7, dateTo: '2026-07-12' },
    ), null)
    assert.equal(parseAccountUnclearedReview(
      { ...review, entries: [{ ...entry, occurredOn: '2026-07-13' }] },
      { accountId: 7, dateTo: '2026-07-12' },
    ), null)
    assert.equal(parseAccountUnclearedReview(
      { ...review, accountId: 0 },
      { accountId: 0, dateTo: '2026-07-12' },
    ), null)
    assert.equal(parseAccountUnclearedReview(
      { ...review, entries: [{ ...entry, updatedAt: '2026-07-14 08:00:00' }] },
      { accountId: 7, dateTo: '2026-07-12' },
    ), null)
    assert.equal(parseAccountUnclearedReview(
      { ...review, entries: [{ ...entry, updatedAt: '2026-02-31T08:00:00Z' }] },
      { accountId: 7, dateTo: '2026-07-12' },
    ), null)
    assert.equal(parseAccountUnclearedReview(
      { ...review, entries: [{ ...entry, amountMinor: 0 }] },
      { accountId: 7, dateTo: '2026-07-12' },
    ), null)
    assert.equal(parseAccountUnclearedReview(
      { ...review, clearedEndingBalanceMinor: null },
      { accountId: 7, dateTo: '2026-07-12' },
    ), null)
    assert.equal(parseAccountUnclearedReview(
      { ...review, endingBalanceMinor: 98_751 },
      { accountId: 7, dateTo: '2026-07-12' },
    ), null)
  })

  it('accepts unavailable pre-opening balances only with an empty complete review', () => {
    assert.ok(parseAccountUnclearedReview({
      ...review,
      endingBalanceMinor: null,
      clearedEndingBalanceMinor: null,
      unclearedEndingBalanceMinor: null,
      unclearedCount: 0,
      entries: [],
    }, { accountId: 7, dateTo: '2026-07-12' }))
    assert.equal(parseAccountUnclearedReview({
      ...review,
      endingBalanceMinor: null,
      clearedEndingBalanceMinor: null,
      unclearedEndingBalanceMinor: null,
    }, { accountId: 7, dateTo: '2026-07-12' }), null)
  })

  it('ignores aborted, superseded, and context-stale responses', () => {
    const selection = {
      accountId: 7,
      dateFrom: '2026-06-13',
      dateTo: '2026-07-12',
      draftDateFrom: '2026-06-13',
      draftDateTo: '2026-07-12',
      available: true,
      snapshotVersion: 3,
    }
    const requestContext = accountUnclearedReviewContext(selection)
    const current = {
      requestId: 3,
      activeRequestId: 3,
      requestContext,
      activeContext: requestContext,
      aborted: false,
    }
    assert.equal(accountUnclearedReviewIsCurrent(current), true)
    assert.equal(accountUnclearedReviewIsCurrent({ ...current, aborted: true }), false)
    assert.equal(accountUnclearedReviewIsCurrent({ ...current, activeRequestId: 4 }), false)
    assert.equal(accountUnclearedReviewIsCurrent({
      ...current,
      activeContext: accountUnclearedReviewContext({
        ...selection,
        snapshotVersion: selection.snapshotVersion + 1,
      }),
    }), false)
  })
})
