import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeAppUpdateMode, resolveControllerChange } from './appUpdate'

describe('app update preference', () => {
  it('accepts automatic updates and defaults every other value to manual', () => {
    assert.equal(normalizeAppUpdateMode('automatic'), 'automatic')
    assert.equal(normalizeAppUpdateMode('manual'), 'manual')
    assert.equal(normalizeAppUpdateMode('unexpected'), 'manual')
    assert.equal(normalizeAppUpdateMode(null), 'manual')
  })

  it('reloads only an armed update and flags updates activated by another tab', () => {
    assert.equal(resolveControllerChange(false, true, false), 'current')
    assert.equal(resolveControllerChange(true, true, false), 'restart-required')
    assert.equal(resolveControllerChange(true, true, true), 'reload')
  })
})
