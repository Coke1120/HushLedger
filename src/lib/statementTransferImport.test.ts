import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  statementTransferImportInputSchema,
  statementTransferImportResponseSchema,
} from './statementTransferImport'

const validInput = {
  importKey: `ai:statement:row:${'a'.repeat(64)}`,
  statementAccountId: 1,
  counterpartyAccountId: 2,
  amountMinor: 12_345,
  occurredOn: '2026-08-23',
  direction: 'outflow' as const,
  note: 'Own-account transfer',
}

describe('statement transfer import contract', () => {
  it('accepts the strict source-backed request and response', () => {
    assert.deepEqual(statementTransferImportInputSchema.parse(validInput), validInput)
    assert.deepEqual(statementTransferImportResponseSchema.parse({
      kind: 'created',
      transferId: '10000000-0000-4000-8000-000000000001',
    }), {
      kind: 'created',
      transferId: '10000000-0000-4000-8000-000000000001',
    })
    assert.deepEqual(statementTransferImportResponseSchema.parse({
      kind: 'already_imported',
    }), { kind: 'already_imported' })
    assert.deepEqual(statementTransferImportResponseSchema.parse({
      kind: 'matched',
      transferId: '10000000-0000-4000-8000-000000000001',
    }), {
      kind: 'matched',
      transferId: '10000000-0000-4000-8000-000000000001',
    })
    assert.equal(statementTransferImportResponseSchema.safeParse({
      kind: 'already_imported',
      transferId: '10000000-0000-4000-8000-000000000001',
    }).success, false)
  })

  it('rejects unsafe amounts, non-statement keys, same accounts, and extra fields', () => {
    assert.equal(statementTransferImportInputSchema.safeParse({
      ...validInput,
      amountMinor: Number.MAX_SAFE_INTEGER + 1,
    }).success, false)
    assert.equal(statementTransferImportInputSchema.safeParse({
      ...validInput,
      importKey: `csv:bank:row:${'a'.repeat(64)}`,
    }).success, false)
    assert.equal(statementTransferImportInputSchema.safeParse({
      ...validInput,
      counterpartyAccountId: validInput.statementAccountId,
    }).success, false)
    assert.equal(statementTransferImportInputSchema.safeParse({
      ...validInput,
      currency: 'HKD',
    }).success, false)
  })
})
