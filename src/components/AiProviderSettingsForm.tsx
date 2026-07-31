import { KeyRound, LoaderCircle, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { message, messageForError, renderMessage, useI18n, type LocalizedMessage } from '../i18n'
import { aiProviderConnectionSchema, type AiProviderSettings, type AiProviderSettingsRow } from '../lib/ai'
import { api } from '../lib/api'
import type { AiProviderSettingsStatus } from '../hooks/useMoneyData'

type AiProviderSettingsFormProps = {
  settings: AiProviderSettings
  disabled: boolean
  onChange: (settings: AiProviderSettings) => void
  persistedRow: AiProviderSettingsRow | null
  conflict: boolean
  persistenceStatus: AiProviderSettingsStatus
  onReset: () => void
  onReload: () => Promise<unknown>
  onSave: (settings: AiProviderSettings) => Promise<void>
  onDelete: () => Promise<void>
}

export function AiProviderSettingsForm({
  settings,
  disabled,
  onChange,
  persistedRow,
  conflict,
  persistenceStatus,
  onReset,
  onReload,
  onSave,
  onDelete,
}: AiProviderSettingsFormProps) {
  const { t } = useI18n()
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState<LocalizedMessage | null>(null)
  const [feedbackError, setFeedbackError] = useState(false)
  const requestIdRef = useRef(0)
  const requestControllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    requestIdRef.current += 1
    requestControllerRef.current?.abort()
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      requestIdRef.current += 1
      requestControllerRef.current?.abort()
      requestControllerRef.current = null
      setLoading(false)
      setModels([])
      setStatus('')
      setError('')
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [persistedRow?.updatedAt])

  const update = (patch: Partial<AiProviderSettings>) => {
    if (disabled) return
    requestIdRef.current += 1
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
    setLoading(false)
    onChange({ ...settings, ...patch })
    setModels([])
    setStatus('')
    setError('')
  }

  const loadModels = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled) return
    setStatus('')
    setError('')

    const transientProvider = aiProviderConnectionSchema.safeParse({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
    })
    const canUseStoredProvider = !settings.apiKey.trim()
      && persistenceStatus === 'ready'
      && !conflict
      && persistedRow?.hasApiKey === true
      && settings.baseUrl.trim() === persistedRow.baseUrl
    if (!transientProvider.success && !canUseStoredProvider) {
      setError(t('aiSettingsRequired'))
      return
    }
    const provider = transientProvider.success
      ? { source: 'transient' as const, ...transientProvider.data }
      : { source: 'stored' as const, expectedUpdatedAt: persistedRow!.updatedAt }

    setLoading(true)
    const requestId = ++requestIdRef.current
    requestControllerRef.current?.abort()
    const controller = new AbortController()
    requestControllerRef.current = controller
    try {
      const nextModels = await api<string[]>('/api/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
        signal: controller.signal,
      })
      if (requestId !== requestIdRef.current) return
      setModels(nextModels)
      if (!settings.model && nextModels[0]) onChange({ ...settings, model: nextModels[0] })
      setStatus(
        nextModels.length > 0
          ? t('aiModelsLoaded', { count: nextModels.length })
          : t('aiNoModelsFound'),
      )
    } catch (caught) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return
      setError(renderMessage(t, messageForError(caught, 'errorAiModelsFailed')))
    } finally {
      if (requestId === requestIdRef.current) {
        requestControllerRef.current = null
        setLoading(false)
      }
    }
  }

  const saveSettings = async () => {
    if (disabled || saving || conflict || persistenceStatus !== 'ready') return
    setSaving(true)
    setFeedback(null)
    setFeedbackError(false)
    try {
      await onSave(settings)
      setFeedback(message('aiSettingsSaved'))
    } catch (error) {
      setFeedback(messageForError(error, 'aiSettingsSaveFailed'))
      setFeedbackError(true)
    } finally {
      setSaving(false)
    }
  }

  const deleteSettings = async () => {
    if (
      disabled
      || saving
      || conflict
      || !persistedRow
      || persistenceStatus !== 'ready'
    ) return
    if (!window.confirm(t('aiSettingsDeleteConfirm'))) return
    setSaving(true)
    setFeedback(null)
    setFeedbackError(false)
    try {
      await onDelete()
      setFeedback(message('aiSettingsDeleted'))
    } catch (error) {
      setFeedback(messageForError(error, 'aiSettingsDeleteFailed'))
      setFeedbackError(true)
    } finally {
      setSaving(false)
    }
  }

  const busy = loading || saving
  const canRetainStoredKey = persistedRow?.hasApiKey === true
    && persistenceStatus === 'ready'
    && settings.baseUrl.trim() === persistedRow.baseUrl
  const canSave = Boolean(
    settings.baseUrl.trim()
    && settings.model.trim()
    && (settings.apiKey.trim() || canRetainStoredKey),
  )

  return (
    <div className="settings-panel ai-settings-panel">
      <div className="settings-panel-heading ai-settings-heading">
        <span className="settings-panel-icon" aria-hidden="true">
          <Sparkles />
        </span>
        <div>
          <h3>{t('aiSettingsTitle')}</h3>
          <p>{t('aiSettingsHelp')}</p>
        </div>
      </div>

      <form className="ai-settings-form" onSubmit={loadModels} noValidate>
        <label>
          <span>{t('aiBaseUrl')}</span>
          <input
            type="url"
            value={settings.baseUrl}
            onChange={(event) => update({ baseUrl: event.target.value })}
            placeholder="https://api.openai.com/v1"
            maxLength={2_048}
            autoComplete="url"
            spellCheck={false}
            required
            disabled={busy || disabled}
          />
        </label>

        <label>
          <span>{t('aiApiKey')}</span>
          <span className="ai-key-input">
            <KeyRound aria-hidden="true" />
            <input
              type="password"
              value={settings.apiKey}
              onChange={(event) => update({ apiKey: event.target.value })}
              maxLength={2_048}
              autoComplete="off"
              spellCheck={false}
              required={!persistedRow}
              placeholder={persistedRow ? t('aiStoredKeyPlaceholder') : undefined}
              disabled={busy || disabled}
            />
          </span>
          <small>{t(persistedRow ? 'aiApiKeyStoredHelp' : 'aiApiKeyHelp')}</small>
        </label>

        <label>
          <span>{t('aiModel')}</span>
          <input
            type="text"
            value={settings.model}
            onChange={(event) => update({ model: event.target.value })}
            list="ai-model-options"
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            placeholder={t('aiModelPlaceholder')}
            required
            disabled={busy || disabled}
          />
          <datalist id="ai-model-options">
            {models.map((model) => <option value={model} key={model} />)}
          </datalist>
          <small>{t('aiModelHelp')}</small>
        </label>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {persistenceStatus === 'error' ? (
          <p className="form-error" role="alert">{t('aiSettingsLoadFailed')}</p>
        ) : null}
        <p className="settings-save-status" aria-live="polite" aria-atomic="true">{status}</p>

        <div className="ai-settings-actions">
          <button className="button button-primary" type="submit" disabled={busy || disabled}>
            {loading ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
            {loading ? t('aiLoadingModels') : t('aiLoadModels')}
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={() => void saveSettings()}
            disabled={
              busy
              || disabled
              || conflict
              || !canSave
              || persistenceStatus !== 'ready'
            }
          >
            {saving ? <LoaderCircle className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            {saving ? t('saving') : t('aiSaveSettings')}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void deleteSettings()}
            disabled={
              !persistedRow
              || busy
              || disabled
              || conflict
              || persistenceStatus !== 'ready'
            }
          >
            <Trash2 aria-hidden="true" />
            {t('aiDeleteSettings')}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => update({ apiKey: '' })}
            disabled={!settings.apiKey || busy || disabled}
          >
            <KeyRound aria-hidden="true" />
            {t('aiClearKey')}
          </button>
          {conflict ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                onReset()
                setModels([])
                setStatus('')
                setError('')
                setFeedback(null)
                setFeedbackError(false)
              }}
              disabled={busy || disabled}
            >
              <RefreshCw aria-hidden="true" />
              {t('aiReloadSettings')}
            </button>
          ) : null}
          {persistenceStatus === 'error' ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void onReload()}
              disabled={busy || disabled}
            >
              <RefreshCw aria-hidden="true" />
              {t('retry')}
            </button>
          ) : null}
        </div>
      </form>

      {conflict ? <p className="form-error" role="alert">{t('aiSettingsConflict')}</p> : null}

      <p
        className={`emergency-fund-feedback${feedbackError ? ' is-error' : ''}`}
        role={feedbackError ? 'alert' : 'status'}
        aria-atomic="true"
      >
        {renderMessage(t, feedback)}
      </p>

      <div className="settings-privacy-note">
        <KeyRound aria-hidden="true" />
        <span>{t('aiStorageNote')}</span>
      </div>
    </div>
  )
}
