import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  addSavedTransactionView,
  MAX_SAVED_TRANSACTION_VIEWS,
  parseSavedTransactionViews,
  serializeSavedTransactionViews,
  type SavedTransactionView,
} from './savedTransactionViews'

const validView: SavedTransactionView = {
  id: '248e3e55-d864-4a32-bf48-46bd3608060f',
  name: 'Uncleared card',
  type: 'expense',
  status: 'uncleared',
  accountId: 3,
  categoryId: null,
  search: '',
  tag: null,
}

describe('saved transaction views', () => {
  it('normalizes valid browser data and drops malformed or duplicate entries', () => {
    const parsed = parseSavedTransactionViews(JSON.stringify([
      { ...validView, name: '  Uncleared card  ' },
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
    assert.equal(addSavedTransactionView([], {
      ...validView,
      type: 'all',
      status: 'all',
      accountId: null,
      search: '',
    }).kind, 'invalid')

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

  it('serializes only the bounded validated shape', () => {
    assert.deepEqual(parseSavedTransactionViews(serializeSavedTransactionViews([validView])), [validView])
  })
})
