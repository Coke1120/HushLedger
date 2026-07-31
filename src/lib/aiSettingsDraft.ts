import type { AiProviderSettings, AiProviderSettingsRow } from './ai'

export type AiSettingsDraft = {
  settings: AiProviderSettings
  baseUpdatedAt: string | null
}

export type AiSettingsRowOverride = {
  settings: AiProviderSettingsRow | null
  replacedUpdatedAt: string | null
}

export type AiSettingsMetadataFetchResult =
  | { kind: 'loaded'; settings: AiProviderSettingsRow | null }
  | { kind: 'failed' }

export function updateAiSettingsDraft(
  current: AiSettingsDraft | null,
  settings: AiProviderSettings,
  persistedUpdatedAt: string | null,
): AiSettingsDraft {
  return {
    settings,
    baseUpdatedAt: current?.baseUpdatedAt ?? persistedUpdatedAt,
  }
}

export function aiSettingsDraftHasConflict(
  draft: AiSettingsDraft | null,
  persistedUpdatedAt: string | null,
) {
  return draft !== null && draft.baseUpdatedAt !== persistedUpdatedAt
}

export function aiSettingsRowOverrideIsSuperseded(
  override: AiSettingsRowOverride,
  persistedUpdatedAt: string | null,
) {
  return (
    persistedUpdatedAt === (override.settings?.updatedAt ?? null)
    || persistedUpdatedAt !== override.replacedUpdatedAt
  )
}

export function retainAiSettingsAfterMetadataFetch(
  current: AiProviderSettingsRow | null,
  result: AiSettingsMetadataFetchResult,
) {
  return result.kind === 'loaded' ? result.settings : current
}
