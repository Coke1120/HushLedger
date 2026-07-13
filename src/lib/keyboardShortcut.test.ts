import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isTransactionSaveShortcut } from './keyboardShortcut'

const event = (overrides: Partial<Parameters<typeof isTransactionSaveShortcut>[0]> = {}) => ({
  key: 'Enter',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  ...overrides,
})

describe('transaction save shortcut', () => {
  it('accepts one modified Enter press on Windows, Linux, and macOS', () => {
    assert.equal(isTransactionSaveShortcut(event({ ctrlKey: true })), true)
    assert.equal(isTransactionSaveShortcut(event({ metaKey: true })), true)
  })

  it('leaves typing, browser combinations, and repeated keys untouched', () => {
    assert.equal(isTransactionSaveShortcut(event()), false)
    assert.equal(isTransactionSaveShortcut(event({ ctrlKey: true, key: 'N' })), false)
    assert.equal(isTransactionSaveShortcut(event({ ctrlKey: true, altKey: true })), false)
    assert.equal(isTransactionSaveShortcut(event({ metaKey: true, shiftKey: true })), false)
    assert.equal(isTransactionSaveShortcut(event({ ctrlKey: true, repeat: true })), false)
  })
})
