import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateReconciliationDifference } from './reconciliation'

describe('reconciliation difference', () => {
  it('subtracts the cleared ledger balance from the statement balance exactly', () => {
    assert.equal(calculateReconciliationDifference(101_750, 103_000), -1_250)
    assert.equal(calculateReconciliationDifference(-50_000, -50_000), 0)
  })

  it('rejects arithmetic outside JavaScript safe-integer precision', () => {
    assert.throws(
      () => calculateReconciliationDifference(Number.MAX_SAFE_INTEGER, -1),
      /safe integer/,
    )
  })
})
