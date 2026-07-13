import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateEmergencyFundProgress } from './emergencyFund'

describe('emergency fund progress', () => {
  it('uses exact integer progress without exceeding the target', () => {
    assert.deepEqual(calculateEmergencyFundProgress(250_001, 1_000_000), {
      savedMinor: 250_001,
      remainingMinor: 749_999,
      basisPoints: 2_500,
      complete: false,
    })
    assert.deepEqual(calculateEmergencyFundProgress(1_250_000, 1_000_000), {
      savedMinor: 1_000_000,
      remainingMinor: 0,
      basisPoints: 10_000,
      complete: true,
    })
  })

  it('treats debt as zero progress and preserves unavailable history', () => {
    assert.deepEqual(calculateEmergencyFundProgress(-12_300, 50_000), {
      savedMinor: 0,
      remainingMinor: 50_000,
      basisPoints: 0,
      complete: false,
    })
    assert.deepEqual(calculateEmergencyFundProgress(null, 50_000), {
      savedMinor: null,
      remainingMinor: null,
      basisPoints: null,
      complete: false,
    })
  })

  it('rejects invalid values instead of producing misleading progress', () => {
    assert.throws(() => calculateEmergencyFundProgress(1, 0))
    assert.throws(() => calculateEmergencyFundProgress(Number.MAX_VALUE, 100))
  })
})
