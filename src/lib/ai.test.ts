import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_AI_DRAFT_ROWS,
  aiImportRequestSchema,
  aiModelOutputSchema,
  aiParseRequestSchema,
  aiProviderSettingsSchema,
  bankImportDraftSchema,
} from './ai'

const provider = {
  baseUrl: 'https://provider.example/v1',
  apiKey: 'test-key',
  model: 'test-model',
}

const modelRow = {
  sourceLine: 1,
  occurredOn: '2026-07-11',
  direction: 'expense',
  amountText: '123.45',
  currency: 'HKD',
  description: 'Example merchant',
  suggestedCategoryName: '餐飲',
  confidence: 0.92,
  flags: [],
}

describe('AI import schemas', () => {
  it('accepts a strict provider and parse request', () => {
    assert.deepEqual(aiProviderSettingsSchema.parse(provider), provider)
    assert.equal(aiParseRequestSchema.safeParse({
      provider,
      accountId: 1,
      currency: 'HKD',
      dateOrder: 'DMY',
      statementText: '11/07/2026 Example merchant 123.45 DR',
    }).success, true)
  })

  for (const [label, value] of [
    ['missing model', { ...provider, model: '' }],
    ['unknown setting', { ...provider, persist: true }],
    ['unsafe API key', { ...provider, apiKey: 'fictional\nheader' }],
    ['unsupported currency', {
      provider,
      accountId: 1,
      currency: 'JPY',
      dateOrder: 'DMY',
      statementText: 'record',
    }],
  ] as const) {
    it(`rejects ${label}`, () => {
      const schema = label.includes('setting') || label.includes('model') || label.includes('API key')
        ? aiProviderSettingsSchema
        : aiParseRequestSchema
      assert.equal(schema.safeParse(value).success, false)
    })
  }

  it('accepts strict model output but rejects database IDs and invalid dates', () => {
    assert.equal(aiModelOutputSchema.safeParse({ rows: [modelRow] }).success, true)
    assert.equal(aiModelOutputSchema.safeParse({
      rows: [{ ...modelRow, amountMinor: 12_345 }],
    }).success, false)
    assert.equal(aiModelOutputSchema.safeParse({
      rows: [{ ...modelRow, occurredOn: '2026-02-30' }],
    }).success, false)
  })

  it('caps model rows and requires known warning flags', () => {
    assert.equal(aiModelOutputSchema.safeParse({
      rows: Array.from({ length: MAX_AI_DRAFT_ROWS + 1 }, () => modelRow),
    }).success, false)
    assert.equal(aiModelOutputSchema.safeParse({
      rows: [{ ...modelRow, flags: ['FOLLOW_STATEMENT_INSTRUCTIONS'] }],
    }).success, false)
  })

  it('keeps normalized drafts strict', () => {
    const draft = {
      id: '019f5087-229b-7ce3-a76f-95c833dcf251',
      importKey: `ai:statement:row:${'a'.repeat(64)}`,
      sourceLine: 1,
      sourceText: 'Example merchant 123.45 DR',
      occurredOn: '2026-07-11',
      type: 'expense',
      amountText: '123.45',
      amountMinor: 12_345,
      currency: 'HKD',
      accountId: 1,
      categoryId: 3,
      payee: 'Example merchant',
      confidence: 0.92,
      flags: [],
    }
    assert.equal(bankImportDraftSchema.safeParse(draft).success, true)
    assert.equal(bankImportDraftSchema.safeParse({ ...draft, apiKey: 'secret' }).success, false)
    assert.equal(aiImportRequestSchema.safeParse({
      mode: 'preview',
      rows: [{
        id: draft.id,
        importKey: draft.importKey,
        sourceRow: draft.sourceLine,
        include: false,
        type: draft.type,
        amountMinor: draft.amountMinor,
        currency: draft.currency,
        accountId: draft.accountId,
        categoryId: draft.categoryId,
        occurredOn: draft.occurredOn,
        payee: draft.payee,
        note: '',
      }],
    }).success, true)
    assert.equal(aiImportRequestSchema.safeParse({
      mode: 'preview',
      rows: [{ ...draft, sourceRow: 1, include: false, note: '', importKey: `csv:hushledger:row:${'a'.repeat(64)}` }],
    }).success, false)
  })
})
