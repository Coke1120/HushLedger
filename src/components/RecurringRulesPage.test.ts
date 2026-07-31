import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { resolveRecurringSurface } from '../lib/recurringSurface'

const pageSource = readFileSync(new URL('./RecurringRulesPage.tsx', import.meta.url), 'utf8')

describe('recurring surface selection', () => {
  it('keeps the user-selected surface without a focused request', () => {
    assert.equal(resolveRecurringSurface('transactions', false, false), 'transactions')
    assert.equal(resolveRecurringSurface('transfers', false, false), 'transfers')
  })

  it('opens the surface required by focused rules and drafts', () => {
    assert.equal(resolveRecurringSurface('transfers', true, false), 'transactions')
    assert.equal(resolveRecurringSurface('transactions', false, true), 'transfers')
  })

  it('prioritizes an explicit transfer focus request', () => {
    assert.equal(resolveRecurringSurface('transactions', true, true), 'transfers')
  })

  it('keeps the transfer lane mounted while hiding its inactive surface', () => {
    assert.match(pageSource, /<div hidden=\{visibleSurface !== 'transfers'\}>/)
    assert.equal(pageSource.split('<RecurringTransferRulesPanel').length - 1, 1)
  })
})
