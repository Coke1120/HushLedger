import assert from 'node:assert/strict'
import { it } from 'node:test'
import { pasteRequestSchema, sourceHasExplicitYear } from './pasteApproval'

const row = {
  id: '10000000-0000-4000-8000-000000000001',
  importKey: `ai:statement:row:${'a'.repeat(64)}`,
  type: 'expense', amountMinor: 1234, currency: 'HKD', accountId: 1, categoryId: 3,
  occurredOn: '2026-10-20', payee: 'Fictional shop', note: '', cleared: true, duplicateConfirmed: false,
}
it('requires explicit approval mode, revision, stable operation ID and unique rows', () => {
  const request = { mode: 'approve', operationId: crypto.randomUUID(), expectedRevision: 1, rows: [row] }
  assert(pasteRequestSchema.safeParse(request).success)
  assert(!pasteRequestSchema.safeParse({ ...request, expectedRevision: undefined }).success)
  assert(!pasteRequestSchema.safeParse({ ...request, rows: [row, row] }).success)
  assert(!pasteRequestSchema.safeParse({ ...request, rows: [] }).success)
  assert(!pasteRequestSchema.safeParse({ ...request, approved: true }).success)
})
it('rejects mixed-account batches, invalid dates, unsafe amounts and authority-bearing fields', () => {
  for (const patch of [{ occurredOn: '2026-02-30' }, { amountMinor: 1.5 }, { amountMinor: 0 }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { tenantId: 'someone-else' }]) {
    assert(!pasteRequestSchema.safeParse({ mode: 'preview', rows: [{ ...row, ...patch }] }).success)
  }
  assert(!pasteRequestSchema.safeParse({ mode: 'preview', rows: [row, {
    ...row, id: '10000000-0000-4000-8000-000000000002',
    importKey: `ai:statement:row:${'b'.repeat(64)}`, accountId: 2,
  }] }).success)
})

it('does not treat an amount resembling a year as date evidence', () => {
  assert(sourceHasExplicitYear('2026-10-20 Fictional merchant 48.00', '2026-10-20'))
  assert(sourceHasExplicitYear('20/10/2026 Fictional merchant 48.00', '2026-10-20'))
  assert(!sourceHasExplicitYear('10/20 Fictional merchant 2026.00', '2026-10-20'))
  assert(!sourceHasExplicitYear('10/20 Fictional merchant 48.00', '2026-10-20'))
})
