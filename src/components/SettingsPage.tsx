import { Check, Languages, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { languageOptions, useI18n, type Locale } from '../i18n'
import type { AiProviderSettings } from '../lib/ai'
import { AiProviderSettingsForm } from './AiProviderSettingsForm'

type SettingsPageProps = {
  aiSettings: AiProviderSettings
  onAiSettingsChange: (settings: AiProviderSettings) => void
}

export function SettingsPage({ aiSettings, onAiSettingsChange }: SettingsPageProps) {
  const { locale, setLocale, t } = useI18n()
  const [saved, setSaved] = useState(false)

  const chooseLanguage = (nextLocale: Locale) => {
    setLocale(nextLocale)
    setSaved(true)
  }

  return (
    <section className="settings-page" aria-labelledby="settings-page-title">
      <div className="settings-hero">
        <span className="settings-hero-icon" aria-hidden="true">
          <Languages />
        </span>
        <div>
          <h2 id="settings-page-title">{t('settingsTitle')}</h2>
          <p>{t('settingsDescription')}</p>
        </div>
      </div>

      <div className="settings-panel">
        <div className="settings-panel-heading">
          <div>
            <h3>{t('languageAndDisplay')}</h3>
            <p>{t('languageHelp')}</p>
          </div>
        </div>

        <fieldset className="language-fieldset">
          <legend>{t('interfaceLanguage')}</legend>
          <span className="language-options-label">{t('languageOptions')}</span>
          <div className="language-options">
            {languageOptions.map((option) => {
              const selected = locale === option.locale
              return (
                <label className={`language-option ${selected ? 'is-selected' : ''}`} key={option.locale}>
                  <input
                    type="radio"
                    name="interface-language"
                    value={option.locale}
                    checked={selected}
                    onChange={() => chooseLanguage(option.locale)}
                  />
                  <span className="language-option-copy">
                    <strong lang={option.locale}>{option.label}</strong>
                    <small>{option.locale}</small>
                  </span>
                  <span className="language-option-check" aria-hidden="true">
                    <Check />
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <div className="settings-privacy-note">
          <LockKeyhole aria-hidden="true" />
          <span>{t('localPreferenceNote')}</span>
        </div>

        <p className="settings-save-status" aria-live="polite" aria-atomic="true">
          {saved ? t('languageSaved') : ''}
        </p>
      </div>

      <AiProviderSettingsForm settings={aiSettings} onChange={onAiSettingsChange} />
    </section>
  )
}
