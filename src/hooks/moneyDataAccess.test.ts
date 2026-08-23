import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  moneyMutationSource,
  sourceAfterMoneyRefreshFailure,
} from './moneyDataAccess'

describe('money data access after refresh failures', () => {
  it('fails closed when an online refresh fails instead of enabling demo saves', () => {
    const source = sourceAfterMoneyRefreshFailure(true, 'demo', true)

    assert.equal(source, 'error')
    assert.equal(moneyMutationSource(source, true, null), null)
    assert.equal(moneyMutationSource('live', true, null), null)
  })

  it('keeps the initial offline demo fallback read-only and preserves live data thereafter', () => {
    assert.equal(sourceAfterMoneyRefreshFailure(false, 'demo', true), 'demo')
    assert.equal(moneyMutationSource('demo', false, 'demo'), null)
    assert.equal(sourceAfterMoneyRefreshFailure(false, 'demo', false), 'error')
  })

  it('allows mutations only for live data or an explicitly writable demo', () => {
    assert.equal(moneyMutationSource('live', true, 'live'), 'live')
    assert.equal(moneyMutationSource('demo', true, 'demo'), 'demo')
    assert.equal(moneyMutationSource('demo', true, null), null)
  })
})
