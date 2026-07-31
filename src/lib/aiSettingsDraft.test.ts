import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  aiSettingsDraftHasConflict,
  aiSettingsRowOverrideIsSuperseded,
  retainAiSettingsAfterMetadataFetch,
  updateAiSettingsDraft,
} from './aiSettingsDraft'

const originalUpdatedAt = '2026-07-31T08:00:00.000Z'
const refreshedUpdatedAt = '2026-07-31T08:01:00.000Z'
const originalSettings = {
  baseUrl: 'https://fictional-provider.example/v1',
  apiKey: 'fictional-api-key',
  model: 'fictional-model-v1',
}

describe('AI settings draft version tracking', () => {
  it('retains the original base version after persisted settings refresh', () => {
    const original = updateAiSettingsDraft(null, originalSettings, originalUpdatedAt)
    const edited = updateAiSettingsDraft(
      original,
      { ...originalSettings, model: 'fictional-model-v2' },
      refreshedUpdatedAt,
    )

    assert.equal(edited.baseUpdatedAt, originalUpdatedAt)
  })

  it('reports a conflict when the persisted version advances', () => {
    const draft = updateAiSettingsDraft(null, originalSettings, originalUpdatedAt)

    assert.equal(aiSettingsDraftHasConflict(draft, refreshedUpdatedAt), true)
  })

  it('reports a conflict when a persisted row appears behind a new draft', () => {
    const draft = updateAiSettingsDraft(null, originalSettings, null)

    assert.equal(aiSettingsDraftHasConflict(draft, originalUpdatedAt), true)
  })

  it('reports a conflict when the persisted row disappears', () => {
    const draft = updateAiSettingsDraft(null, originalSettings, originalUpdatedAt)

    assert.equal(aiSettingsDraftHasConflict(draft, null), true)
  })

  it('reports no conflict while the persisted version is unchanged', () => {
    const draft = updateAiSettingsDraft(null, originalSettings, originalUpdatedAt)

    assert.equal(aiSettingsDraftHasConflict(draft, originalUpdatedAt), false)
  })
})

describe('AI settings row override lifetime', () => {
  const savedOverride = {
    settings: {
      baseUrl: originalSettings.baseUrl,
      model: 'fictional-model-v2',
      hasApiKey: true as const,
      createdAt: originalUpdatedAt,
      updatedAt: refreshedUpdatedAt,
    },
    replacedUpdatedAt: originalUpdatedAt,
  }

  it('keeps a saved override while the source still has the replaced version', () => {
    assert.equal(
      aiSettingsRowOverrideIsSuperseded(savedOverride, originalUpdatedAt),
      false,
    )
  })

  it('clears a saved override when the source reaches the saved version', () => {
    assert.equal(
      aiSettingsRowOverrideIsSuperseded(savedOverride, refreshedUpdatedAt),
      true,
    )
  })

  it('clears a saved override when another newer source version appears', () => {
    assert.equal(
      aiSettingsRowOverrideIsSuperseded(savedOverride, '2026-07-31T08:02:00.000Z'),
      true,
    )
  })

  it('keeps a deletion override while the source still has the deleted version', () => {
    assert.equal(aiSettingsRowOverrideIsSuperseded({
      settings: null,
      replacedUpdatedAt: originalUpdatedAt,
    }, originalUpdatedAt), false)
  })

  it('clears a deletion override when the source becomes null', () => {
    assert.equal(aiSettingsRowOverrideIsSuperseded({
      settings: null,
      replacedUpdatedAt: originalUpdatedAt,
    }, null), true)
  })
})

describe('AI settings metadata refresh', () => {
  const persisted = {
    baseUrl: originalSettings.baseUrl,
    model: originalSettings.model,
    hasApiKey: true as const,
    createdAt: originalUpdatedAt,
    updatedAt: originalUpdatedAt,
  }

  it('preserves the last known row when metadata loading fails', () => {
    assert.deepEqual(
      retainAiSettingsAfterMetadataFetch(persisted, { kind: 'failed' }),
      persisted,
    )
  })

  it('accepts a successful row deletion response', () => {
    assert.equal(
      retainAiSettingsAfterMetadataFetch(persisted, { kind: 'loaded', settings: null }),
      null,
    )
  })
})
