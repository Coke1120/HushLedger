import { ArrowUpRight, Landmark, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { message, messageForError, renderMessage, useI18n, type LocalizedMessage } from '../i18n'
import { api } from '../lib/api'
import type { SupportedCurrency } from '../lib/currency'

type StoredEcbReferenceRate = {
  quoteCurrency: SupportedCurrency
  rate: string
  observedOn: string
  fetchedAt: string
}

type EcbReferenceRateResponse = {
  source: 'ecb'
  baseCurrency: 'EUR'
  rates: StoredEcbReferenceRate[]
}

type EcbReferenceRateSettingsProps = {
  enabled: boolean
  onBusyChange: (busy: boolean) => void
}

export function EcbReferenceRateSettings({
  enabled,
  onBusyChange,
}: EcbReferenceRateSettingsProps) {
  const { t } = useI18n()
  const [rates, setRates] = useState<StoredEcbReferenceRate[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const [feedback, setFeedback] = useState<LocalizedMessage | null>(null)
  const [feedbackError, setFeedbackError] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let active = true
    void api<EcbReferenceRateResponse>('/api/exchange-rates/ecb')
      .then((response) => {
        if (active) setRates(response.rates)
      })
      .catch((error) => {
        if (active) {
          setFeedback(messageForError(error, 'errorEcbReferenceRatesUnavailable'))
          setFeedbackError(true)
        }
      })
    return () => { active = false }
  }, [enabled])

  async function fetchRates() {
    if (!enabled || fetching) return
    setFetching(true)
    onBusyChange(true)
    setFeedback(null)
    setFeedbackError(false)
    try {
      const response = await api<EcbReferenceRateResponse>('/api/exchange-rates/ecb', {
        method: 'POST',
      })
      setRates(response.rates)
      setFeedback(message('ecbReferenceRatesSaved'))
    } catch (error) {
      setFeedback(messageForError(error, 'errorEcbReferenceRatesUnavailable'))
      setFeedbackError(true)
    } finally {
      setFetching(false)
      onBusyChange(false)
    }
  }

  return (
    <section className="settings-panel ecb-reference-rates" aria-labelledby="ecb-reference-rates-title">
      <div className="settings-panel-heading emergency-fund-settings-heading">
        <span className="settings-panel-icon" aria-hidden="true"><Landmark /></span>
        <div>
          <h3 id="ecb-reference-rates-title">{t('ecbReferenceRatesTitle')}</h3>
          <p>{t('ecbReferenceRatesHelp')}</p>
        </div>
      </div>

      <div className="ecb-reference-rates-body" aria-busy={fetching}>
        {!enabled ? <p className="emergency-fund-settings-unavailable">{t('ecbReferenceRatesUnavailable')}</p> : null}
        <div className="emergency-fund-form-actions">
          <button className="button button-primary" type="button" disabled={!enabled || fetching} onClick={fetchRates}>
            <RefreshCw className={fetching ? 'ecb-fetch-spinner' : undefined} aria-hidden="true" />
            {fetching ? t('ecbReferenceRatesFetching') : t('ecbReferenceRatesFetch')}
          </button>
        </div>

        {rates === null ? null : rates.length === 0 ? (
          <p className="ecb-reference-rates-empty">{t('ecbReferenceRatesEmpty')}</p>
        ) : (
          <details className="ecb-rates-details">
            <summary>{t('ecbReferenceRatesCount', { count: rates.length })}</summary>
            <ul className="ecb-reference-rates-list" aria-label={t('ecbReferenceRatesTitle')}>
            {rates.map((rate) => (
              <li key={`${rate.quoteCurrency}-${rate.observedOn}`}>
                <strong>1 EUR = {rate.rate} {rate.quoteCurrency}</strong>
                <span>{t('ecbReferenceRatesObservedOn', { date: rate.observedOn })}</span>
                <span>{t('ecbReferenceRatesFetchedAt', { date: rate.fetchedAt.slice(0, 10) })}</span>
              </li>
            ))}
            </ul>
          </details>
        )}
        <a className="ecb-source-link" href="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html" target="_blank" rel="noreferrer">
          {t('ecbReferenceRatesSource')} <ArrowUpRight aria-hidden="true" />
        </a>

        <p
          className={`emergency-fund-feedback${feedbackError ? ' is-error' : ''}`}
          role={feedbackError ? 'alert' : 'status'}
          aria-atomic="true"
        >
          {renderMessage(t, feedback)}
        </p>
      </div>
    </section>
  )
}
