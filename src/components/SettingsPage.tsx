import { Check, Coffee, Heart, Languages, LockKeyhole, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { languageOptions, useI18n, type Locale, type MessageKey } from '../i18n'
import type { AiProviderSettings } from '../lib/ai'
import type { LedgerCurrencySettings } from '../lib/currency'
import type { Account, Category, EmergencyFundGoal } from '../lib/schema'
import { AiProviderSettingsForm } from './AiProviderSettingsForm'
import { EmergencyFundSettings } from './EmergencyFundSettings'
import {
  LedgerBackupSettings,
  type LedgerRestoredResult,
} from './LedgerBackupSettings'
import { LedgerCurrencySettingsPanel } from './LedgerCurrencySettings'
import { ReferenceDataSettings } from './ReferenceDataSettings'
import { useAppUpdate, type AppUpdateStatus } from './appUpdateContext'

const updateStatusKeys: Readonly<Partial<Record<AppUpdateStatus, MessageKey>>> = {
  checking: 'checkingForUpdates',
  current: 'updateCurrent',
  available: 'updateAvailable',
  installing: 'updateInstalling',
  'restart-required': 'updateRestartRequired',
  unsupported: 'updateUnsupported',
  error: 'updateFailed',
}

const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/Coke1120'
const BUY_ME_A_COFFEE_URL = 'https://buymeacoffee.com/Coke1120'

type SettingsPageProps = {
  aiSettings: AiProviderSettings
  onAiSettingsChange: (settings: AiProviderSettings) => void
  accounts: Account[]
  categories: Category[]
  emergencyFundGoal: EmergencyFundGoal | null
  ledgerSettings: LedgerCurrencySettings
  canManageReferences: boolean
  onReferenceRefresh: () => Promise<boolean>
  onLedgerRestored: () => Promise<LedgerRestoredResult>
}

export function SettingsPage({
  aiSettings,
  onAiSettingsChange,
  accounts,
  categories,
  emergencyFundGoal,
  ledgerSettings,
  canManageReferences,
  onReferenceRefresh,
  onLedgerRestored,
}: SettingsPageProps) {
  const { locale, privacyMode, setLocale, setPrivacyMode, t } = useI18n()
  const { mode, status, setMode, checkForUpdate, installUpdate } = useAppUpdate()
  const [saved, setSaved] = useState(false)

  const chooseLanguage = (nextLocale: Locale) => {
    setLocale(nextLocale)
    setSaved(true)
  }

  const updateStatusKey = updateStatusKeys[status]
  const updateStatus = updateStatusKey ? t(updateStatusKey) : ''

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

      <LedgerCurrencySettingsPanel
        settings={ledgerSettings}
        enabled={canManageReferences}
        onRefresh={onReferenceRefresh}
      />

      <EmergencyFundSettings
        key={`emergency-fund-${ledgerSettings.updatedAt}`}
        goal={emergencyFundGoal}
        accounts={accounts}
        expectedCurrency={ledgerSettings.currency}
        enabled={canManageReferences}
        onRefresh={onReferenceRefresh}
      />

      <ReferenceDataSettings
        key={`reference-data-${ledgerSettings.updatedAt}`}
        accounts={accounts}
        categories={categories}
        expectedCurrency={ledgerSettings.currency}
        enabled={canManageReferences}
        onRefresh={onReferenceRefresh}
      />

      <LedgerBackupSettings
        available={canManageReferences}
        onRestored={onLedgerRestored}
      />

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

        <label className={`privacy-mode-option${privacyMode ? ' is-selected' : ''}`}>
          <input
            type="checkbox"
            checked={privacyMode}
            onChange={(event) => setPrivacyMode(event.target.checked)}
          />
          <span className="privacy-mode-copy">
            <strong>{t('screenPrivacy')}</strong>
            <small>{t('screenPrivacyHelp')}</small>
          </span>
          <span className="privacy-mode-switch" aria-hidden="true"><span /></span>
        </label>

        <div className="settings-privacy-note">
          <LockKeyhole aria-hidden="true" />
          <span>{t('localPreferenceNote')}</span>
        </div>

        <p className="settings-save-status" aria-live="polite" aria-atomic="true">
          {saved ? t('languageSaved') : ''}
        </p>
      </div>

      <div className="settings-panel">
        <div className="settings-panel-heading">
          <div>
            <h3>{t('appUpdatesTitle')}</h3>
            <p>{t('appUpdatesHelp')}</p>
          </div>
        </div>

        <div className="settings-update-form">
          <label>
            <span>{t('updatePreference')}</span>
            <select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value === 'automatic' ? 'automatic' : 'manual')
              }}
              disabled={status === 'installing'}
            >
              <option value="manual">{t('updateManual')}</option>
              <option value="automatic">{t('updateAutomatic')}</option>
            </select>
            <small>
              {mode === 'automatic' ? t('updateAutomaticHelp') : t('updateManualHelp')}
            </small>
          </label>

          <div className="settings-update-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void checkForUpdate()}
              disabled={
                status === 'idle'
                || status === 'checking'
                || status === 'installing'
                || status === 'restart-required'
                || status === 'unsupported'
              }
            >
              <RefreshCw aria-hidden="true" />
              {status === 'checking' ? t('checkingForUpdates') : t('checkForUpdates')}
            </button>
            {(status === 'available' || status === 'restart-required') && (
              <button type="button" className="button button-primary" onClick={installUpdate}>
                {status === 'restart-required' ? t('restartNow') : t('installAndRestart')}
              </button>
            )}
          </div>

          <p className="settings-update-status" aria-live="polite" aria-atomic="true">
            {updateStatus}
          </p>
        </div>
      </div>

      <div className="settings-panel">
        <div className="settings-panel-heading">
          <div>
            <h3>{t('supportHushLedgerTitle')}</h3>
            <p>{t('supportHushLedgerHelp')}</p>
          </div>
        </div>

        <div className="settings-support-actions">
          <a className="button button-primary settings-support-link" href={GITHUB_SPONSORS_URL}>
            <Heart aria-hidden="true" />
            {t('githubSponsors')}
          </a>
          <a className="button button-secondary settings-support-link" href={BUY_ME_A_COFFEE_URL}>
            <Coffee aria-hidden="true" />
            {t('buyMeACoffee')}
          </a>
        </div>
      </div>

      <AiProviderSettingsForm settings={aiSettings} onChange={onAiSettingsChange} />
    </section>
  )
}
