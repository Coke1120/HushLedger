import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_AI_DRAFT_ROWS,
  aiImportRequestSchema,
  aiModelOutputSchema,
  aiParseRequestSchema,
  aiProviderSettingsSchema,
  bankImportDraftSchema,
  bankStatementParseResultSchema,
  calculateBankStatementVerification,
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

const modelOutput = {
  openingBalance: null,
  closingBalance: null,
  debitTotal: null,
  creditTotal: null,
  rows: [modelRow],
}

describe('AI import schemas', () => {
  it('accepts a strict provider and parse request', () => {
    assert.deepEqual(aiProviderSettingsSchema.parse(provider), provider)
    assert.equal(aiParseRequestSchema.safeParse({
      provider: { source: 'transient', ...provider },
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
      provider: { source: 'transient', ...provider },
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
    assert.equal(aiModelOutputSchema.safeParse(modelOutput).success, true)
    assert.equal(aiModelOutputSchema.safeParse({
      ...modelOutput,
      rows: [{ ...modelRow, amountMinor: 12_345 }],
    }).success, false)
    assert.equal(aiModelOutputSchema.safeParse({
      ...modelOutput,
      rows: [{ ...modelRow, occurredOn: '2026-02-30' }],
    }).success, false)
  })

  it('requires literal canonical amounts and nullable source-backed statement totals', () => {
    assert.equal(aiModelOutputSchema.safeParse({
      ...modelOutput,
      openingBalance: { sourceLine: 1, amountText: '-120.50' },
      closingBalance: { sourceLine: 3, amountText: '0.00' },
      debitTotal: { sourceLine: 4, amountText: '123.45' },
      creditTotal: { sourceLine: 5, amountText: '0' },
    }).success, true)

    for (const amountText of ['100+20', '01.00', '-1.00', '0', '1,000.00']) {
      assert.equal(aiModelOutputSchema.safeParse({
        ...modelOutput,
        rows: [{ ...modelRow, amountText }],
      }).success, false)
    }
    assert.equal(aiModelOutputSchema.safeParse({
      ...modelOutput,
      debitTotal: { sourceLine: 4, amountText: '-1.00' },
    }).success, false)
    assert.equal(aiModelOutputSchema.safeParse({ rows: [modelRow] }).success, false)
  })

  it('recalculates statement verification from the current transaction entries', () => {
    const evidence = {
      openingBalance: {
        sourceLine: 1,
        sourceText: 'Opening 100.00',
        amountText: '100.00',
        amountMinor: 10_000,
      },
      closingBalance: {
        sourceLine: 3,
        sourceText: 'Closing 80.00',
        amountText: '80.00',
        amountMinor: 8_000,
      },
      debitTotal: {
        sourceLine: 4,
        sourceText: 'Debits 20.00',
        amountText: '20.00',
        amountMinor: 2_000,
      },
      creditTotal: null,
    }

    const matched = calculateBankStatementVerification(
      evidence,
      [{ type: 'expense', amountMinor: 2_000 }],
    )
    assert.equal(matched.status, 'matched')
    const edited = calculateBankStatementVerification(
      matched,
      [{ type: 'expense', amountMinor: 2_100 }],
    )
    assert.equal(edited.status, 'mismatch')
    assert.equal(edited.balanceDifferenceMinor, 100)
    assert.equal(edited.debitDifferenceMinor, -100)
  })

  it('does not call a matching one-sided statement total fully matched', () => {
    const evidence = {
      openingBalance: null,
      closingBalance: null,
      debitTotal: {
        sourceLine: 1,
        sourceText: 'Debits 20.00',
        amountText: '20.00',
        amountMinor: 2_000,
      },
      creditTotal: null,
    }
    assert.equal(calculateBankStatementVerification(
      evidence,
      [{ type: 'expense', amountMinor: 2_000 }],
    ).status, 'unavailable')
    assert.equal(calculateBankStatementVerification(
      evidence,
      [{ type: 'expense', amountMinor: 2_100 }],
    ).status, 'mismatch')
  })

  it('caps model rows and requires known warning flags', () => {
    assert.equal(aiModelOutputSchema.safeParse({
      ...modelOutput,
      rows: Array.from({ length: MAX_AI_DRAFT_ROWS + 1 }, () => modelRow),
    }).success, false)
    assert.equal(aiModelOutputSchema.safeParse({
      ...modelOutput,
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
    assert.equal(bankStatementParseResultSchema.safeParse({
      drafts: [draft],
      verification: {
        status: 'unavailable',
        openingBalance: null,
        closingBalance: null,
        debitTotal: null,
        creditTotal: null,
        parsedIncomeMinor: 0,
        parsedExpenseMinor: 12_345,
        parsedNetMinor: -12_345,
        balanceDifferenceMinor: null,
        debitDifferenceMinor: null,
        creditDifferenceMinor: null,
      },
    }).success, true)
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
