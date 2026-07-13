import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { noteHasTransactionTag, transactionTagsFromNote } from './transactionTags'

describe('transaction note tags', () => {
  it('extracts unique whitespace-delimited tags without rewriting their display form', () => {
    assert.deepEqual(
      transactionTagsFromNote('Summer trip #Japan2026 #rail-pass #友達 #Japan2026'),
      ['#Japan2026', '#rail-pass', '#友達'],
    )
  })

  it('ignores escaped, malformed, punctuated, and oversized tokens', () => {
    assert.deepEqual(
      transactionTagsFromNote('##private # #trip, #_hidden #valid_tag #joined\u00a0#stuck #' + 'a'.repeat(41)),
      ['#valid_tag'],
    )
  })

  it('matches one complete tag token with case-sensitive semantics', () => {
    const note = '#Trip planning #trip2\n#旅程'

    assert.equal(noteHasTransactionTag(note, '#Trip'), true)
    assert.equal(noteHasTransactionTag(note, '#trip'), false)
    assert.equal(noteHasTransactionTag(note, '#trip2'), true)
    assert.equal(noteHasTransactionTag(note, '#旅程'), true)
  })
})
