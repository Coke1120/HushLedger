import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  aiModelsRequestSchema,
  aiParseRequestSchema,
  aiProviderSettingsMetadataSchema,
} from './ai'

const updatedAt = '2026-07-31T08:00:00.000Z'

describe('AI provider settings schemas', () => {
  it('accepts a stored provider reference without browser-visible credentials', () => {
    const parsed = aiModelsRequestSchema.parse({
      provider: { source: 'stored', expectedUpdatedAt: updatedAt },
    })

    assert.deepEqual(parsed.provider, { source: 'stored', expectedUpdatedAt: updatedAt })
    assert.equal('apiKey' in parsed.provider, false)
  })

  it('accepts a complete transient provider for model discovery', () => {
    const parsed = aiModelsRequestSchema.parse({
      provider: {
        source: 'transient',
        baseUrl: 'https://fictional-provider.example/v1',
        apiKey: 'fictional-transient-key',
      },
    })

    assert.equal(parsed.provider.source, 'transient')
  })

  it('requires a model for transient statement parsing', () => {
    const parsed = aiParseRequestSchema.safeParse({
      provider: {
        source: 'transient',
        baseUrl: 'https://fictional-provider.example/v1',
        apiKey: 'fictional-transient-key',
      },
      accountId: 1,
      currency: 'HKD',
      dateOrder: 'DMY',
      statementText: '31/07/2026 Fictional shop 10.00',
    })

    assert.equal(parsed.success, false)
  })

  it('rejects credentials added to a stored provider reference', () => {
    const parsed = aiModelsRequestSchema.safeParse({
      provider: {
        source: 'stored',
        expectedUpdatedAt: updatedAt,
        apiKey: 'fictional-key-that-must-not-be-accepted',
      },
    })

    assert.equal(parsed.success, false)
  })

  it('rejects API keys in public settings metadata', () => {
    const parsed = aiProviderSettingsMetadataSchema.safeParse({
      baseUrl: 'https://fictional-provider.example/v1',
      model: 'fictional-model',
      hasApiKey: true,
      apiKey: 'fictional-key-that-must-not-be-returned',
      createdAt: updatedAt,
      updatedAt,
    })

    assert.equal(parsed.success, false)
  })
})
