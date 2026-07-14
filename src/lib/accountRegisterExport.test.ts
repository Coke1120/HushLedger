import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  accountRegisterExportCanStart,
  accountRegisterExportIsCurrent,
} from './accountRegisterExport'

describe('account-register export request lifecycle', () => {
  it('blocks edited ranges until the loaded selection catches up', () => {
    assert.equal(accountRegisterExportCanStart({
      canExport: true,
      rangeReady: true,
      rangeChanged: false,
      saving: false,
    }), true)
    assert.equal(accountRegisterExportCanStart({
      canExport: true,
      rangeReady: true,
      rangeChanged: true,
      saving: false,
    }), false)
  })

  it('rejects aborted requests and every stale completion token', () => {
    const current = {
      requestId: 4,
      activeRequestId: 4,
      requestContext: '1:2026-07-01:2026-07-31',
      activeContext: '1:2026-07-01:2026-07-31',
      aborted: false,
    }

    assert.equal(accountRegisterExportIsCurrent(current), true)
    assert.equal(accountRegisterExportIsCurrent({ ...current, activeRequestId: 5 }), false)
    assert.equal(accountRegisterExportIsCurrent({
      ...current,
      activeContext: '1:2026-06-01:2026-07-31',
    }), false)
    assert.equal(accountRegisterExportIsCurrent({ ...current, aborted: true }), false)
  })
})
