import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { actionData } from './actionResult'

describe('Server Action results', () => {
  it('returns successful action data', async () => {
    assert.equal(await actionData(Promise.resolve({ ok: true, data: 42 })), 42)
  })

  it('preserves action error codes for localized client messages', async () => {
    const result = actionData(Promise.resolve({
      ok: false,
      error: { code: 'RULE_VERSION_CONFLICT', message: 'conflict' },
    }))

    await assert.rejects(result, {
      code: 'RULE_VERSION_CONFLICT',
      message: 'conflict',
    })
  })
})
