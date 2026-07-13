import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { confirmDiscardIfDirty, dialogLedgerContextChanged } from './dirtyDialog'

describe('dirty money-entry dialogs', () => {
  it('leaves clean dialogs directly and dirty dialogs only after confirmation', () => {
    let confirmations = 0
    let exits = 0
    const rejectDiscard = () => {
      confirmations += 1
      return false
    }
    const leave = () => {
      exits += 1
    }

    assert.equal(confirmDiscardIfDirty(false, rejectDiscard, leave), true)
    assert.equal(confirmations, 0)
    assert.equal(exits, 1)

    assert.equal(confirmDiscardIfDirty(true, rejectDiscard, leave), false)
    assert.equal(confirmations, 1)
    assert.equal(exits, 1)

    assert.equal(confirmDiscardIfDirty(true, () => true, leave), true)
    assert.equal(exits, 2)
  })

  it('blocks a preserved draft after its ledger context changes', () => {
    assert.equal(dialogLedgerContextChanged('ledger-v1', 'ledger-v1'), false)
    assert.equal(dialogLedgerContextChanged('ledger-v1', 'ledger-v2'), true)
  })
})
