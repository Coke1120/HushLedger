import { Coins } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { message, messageForError, renderMessage, useI18n, type LocalizedMessage } from '../i18n'
import { api } from '../lib/api'
import {
  currencyDisplayName,
  SUPPORTED_CURRENCIES,
  type LedgerCurrencySettings,
  type SupportedCurrency,
} from '../lib/currency'

type LedgerCurrencySettingsProps = {
  settings: LedgerCurrencySettings
  enabled: boolean
  onRefresh: () => Promise<boolean>
  onBusyChange: (busy: boolean) => void
}

export function LedgerCurrencySettingsPanel({
  settings,
  enabled,
  onRefresh,
  onBusyChange,
}: LedgerCurrencySettingsProps) {
  const { locale, t } = useI18n()
  const [selection, setSelection] = useState(() => ({
    currency: settings.currency,
    settingsUpdatedAt: settings.updatedAt,
  }))
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<LocalizedMessage | null>(null)
  const [feedbackError, setFeedbackError] = useState(false)
  const currencyOptions = useMemo(
    () => SUPPORTED_CURRENCIES.map((currency) => ({
      currency,
      label: currencyDisplayName(currency, locale),
    })),
    [locale],
  )
  const selectedCurrency = selection.settingsUpdatedAt === settings.updatedAt
    ? selection.currency
    : settings.currency

  async function saveCurrency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      saving
      || !enabled
      || !settings.canChangeCurrency
      || selectedCurrency === settings.currency
    ) return

    setSaving(true)
    onBusyChange(true)
    setFeedback(null)
    setFeedbackError(false)
    try {
      await api<LedgerCurrencySettings>('/api/ledger-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency: selectedCurrency,
          expectedUpdatedAt: settings.updatedAt,
        }),
      })
      const refreshed = await onRefresh()
      setFeedback(message(refreshed ? 'ledgerCurrencySaved' : 'savedRefreshFailed'))
    } catch (error) {
      setFeedback(messageForError(error, 'ledgerCurrencySaveFailed'))
      setFeedbackError(true)
    } finally {
      setSaving(false)
      onBusyChange(false)
    }
  }

  const disabled = saving || !enabled || !settings.canChangeCurrency

  return (
    <section className="settings-panel" aria-labelledby="ledger-currency-settings-title">
      <div className="settings-panel-heading emergency-fund-settings-heading">
        <span className="settings-panel-icon" aria-hidden="true"><Coins /></span>
        <div>
          <h3 id="ledger-currency-settings-title">{t('ledgerCurrencySettingsTitle')}</h3>
          <p>{t('ledgerCurrencySettingsHelp')}</p>
        </div>
      </div>

      <form
        className="emergency-fund-form ledger-currency-form"
        onSubmit={saveCurrency}
        aria-busy={saving}
      >
        <fieldset disabled={disabled}>
          <label>
            <span>{t('ledgerCurrencyLabel')}</span>
            <select
              value={selectedCurrency}
              onChange={(event) => {
                setSelection({
                  currency: event.target.value as SupportedCurrency,
                  settingsUpdatedAt: settings.updatedAt,
                })
                setFeedback(null)
                setFeedbackError(false)
              }}
              aria-describedby="ledger-currency-help"
            >
              {currencyOptions.map(({ currency, label }) => (
                <option key={currency} value={currency}>
                  {label}
                </option>
              ))}
            </select>
            <small id="ledger-currency-help">{t('ledgerCurrencyFieldHelp')}</small>
          </label>
        </fieldset>

        {!enabled ? (
          <p className="emergency-fund-settings-unavailable">
            {t('ledgerCurrencyUnavailable')}
          </p>
        ) : null}
        {enabled && !settings.canChangeCurrency ? (
          <p className="emergency-fund-settings-unavailable">
            {t('ledgerCurrencyLocked')}
          </p>
        ) : null}

        <div className="emergency-fund-form-actions">
          <button
            className="button button-primary"
            type="submit"
            disabled={disabled || selectedCurrency === settings.currency}
          >
            {saving ? t('saving') : t('saveLedgerCurrency')}
          </button>
        </div>

        <p
          className={`emergency-fund-feedback${feedbackError ? ' is-error' : ''}`}
          role={feedbackError ? 'alert' : 'status'}
          aria-atomic="true"
        >
          {renderMessage(t, feedback)}
        </p>
      </form>
    </section>
  )
}
