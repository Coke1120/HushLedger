import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { categoryComposition } from './categoryComposition'

const item = (amountMinor: number, key = 'a') => ({ key, name: key, color: '#17483c', amountMinor })

describe('monthly category composition', () => {
  it('represents the complete total, including small categories, with stable offsets', () => {
    const model = categoryComposition([item(6000), item(3000, 'b'), item(1000, 'c')], 10000)
    assert.equal(model.state, 'ready')
    assert.deepEqual(model.segments.map(({ share, offset }) => ({ share, offset })), [
      { share: 60, offset: 0 }, { share: 30, offset: 60 }, { share: 10, offset: 90 },
    ])
  })
  it('handles empty, zero and single-category months without imaginary slices', () => {
    assert.equal(categoryComposition([], 0).state, 'empty')
    assert.equal(categoryComposition([item(0)], 0).segments.length, 0)
    assert.equal(categoryComposition([item(200)], 200).segments[0].share, 100)
  })
  it('falls back for negative, partial, invalid and overflowing aggregates', () => {
    for (const [items, total] of [
      [[item(-100)], -100], [[item(100)], 200], [[item(NaN)], 0],
      [[item(Number.MAX_SAFE_INTEGER), item(1, 'b')], Number.MAX_SAFE_INTEGER + 1],
    ] as const) assert.equal(categoryComposition(items, total).state, 'unavailable')
  })
})
