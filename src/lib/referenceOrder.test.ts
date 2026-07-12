import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canMoveReference, orderedReferenceGroup } from './referenceOrder'

type Item = { id: number; type: 'expense' | 'income'; isActive: boolean }

const items: Item[] = [
  { id: 1, type: 'income', isActive: true },
  { id: 2, type: 'income', isActive: true },
  { id: 3, type: 'expense', isActive: true },
  { id: 4, type: 'expense', isActive: false },
  { id: 5, type: 'expense', isActive: true },
]

const groupKey = (item: Item) => `${item.type}:${item.isActive}`

describe('reference ordering', () => {
  it('moves within one type and status group without leaking other items into the payload', () => {
    assert.deepEqual(
      orderedReferenceGroup(items, items[4], 'up', groupKey).map(({ id }) => id),
      [5, 3],
    )
    assert.deepEqual(
      orderedReferenceGroup(items, items[0], 'down', groupKey).map(({ id }) => id),
      [2, 1],
    )
  })

  it('keeps boundary moves unchanged and reports which controls are available', () => {
    assert.deepEqual(
      orderedReferenceGroup(items, items[0], 'up', groupKey).map(({ id }) => id),
      [1, 2],
    )
    assert.equal(canMoveReference(items, items[0], 'up', groupKey), false)
    assert.equal(canMoveReference(items, items[0], 'down', groupKey), true)
    assert.equal(canMoveReference(items, items[1], 'down', groupKey), false)
    assert.equal(canMoveReference(items, items[3], 'up', groupKey), false)
    assert.equal(canMoveReference(items, items[3], 'down', groupKey), false)
  })
})
