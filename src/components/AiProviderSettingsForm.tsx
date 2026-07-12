import { KeyRound, LoaderCircle, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { messageForError, renderMessage, useI18n } from '../i18n'
import { aiProviderConnectionSchema, type AiProviderSettings } from '../lib/ai'
import { api } from '../lib/api'

type AiProviderSettingsFormProps = {
  settings: AiProviderSettings
  onChange: (settings: AiProviderSettings) => void
}

export function AiProviderSettingsForm({ settings, onChange }: AiProviderSettingsFormProps) {
  const { t } = useI18n()
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const requestIdRef = useRef(0)
  const requestControllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    requestIdRef.current += 1
    requestControllerRef.current?.abort()
  }, [])

  const update = (patch: Partial<AiProviderSettings>) => {
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
    setStatus('')
    setError('')

    const provider = aiProviderConnectionSchema.safeParse({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
    })
    if (!provider.success) {
      setError(t('aiSettingsRequired'))
      return
    }

    setLoading(true)
    const requestId = ++requestIdRef.current
    requestControllerRef.current?.abort()
    const controller = new AbortController()
    requestControllerRef.current = controller
    try {
      const nextModels = await api<string[]>('/api/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.data }),
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
            disabled={loading}
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
              required
              disabled={loading}
            />
          </span>
          <small>{t('aiApiKeyHelp')}</small>
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
            disabled={loading}
          />
          <datalist id="ai-model-options">
            {models.map((model) => <option value={model} key={model} />)}
          </datalist>
          <small>{t('aiModelHelp')}</small>
        </label>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <p className="settings-save-status" aria-live="polite" aria-atomic="true">{status}</p>

        <div className="ai-settings-actions">
          <button className="button button-primary" type="submit" disabled={loading}>
            {loading ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
            {loading ? t('aiLoadingModels') : t('aiLoadModels')}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => update({ apiKey: '' })}
            disabled={!settings.apiKey || loading}
          >
            <Trash2 aria-hidden="true" />
            {t('aiClearKey')}
          </button>
        </div>
      </form>

      <div className="settings-privacy-note">
        <KeyRound aria-hidden="true" />
        <span>{t('aiMemoryOnlyNote')}</span>
      </div>
    </div>
  )
}
