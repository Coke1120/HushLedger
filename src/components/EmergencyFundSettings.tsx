import { PiggyBank, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { message, messageForError, renderMessage, useI18n, type LocalizedMessage } from '../i18n'
import { api } from '../lib/api'
import { formatAmountInput, parseAmount, resolveAmountInputLocale } from '../lib/money'
import type { Account, EmergencyFundGoal } from '../lib/schema'

type EmergencyFundSettingsProps = {
  goal: EmergencyFundGoal | null
  accounts: Account[]
  enabled: boolean
  onRefresh: () => Promise<boolean>
}

type EmergencyFundDraft = {
  accountId: number
  target: string
  locale: ReturnType<typeof useI18n>['locale']
  expectedUpdatedAt: string | null
  exists: boolean
}

export function EmergencyFundSettings({
  goal,
  accounts,
  enabled,
  onRefresh,
}: EmergencyFundSettingsProps) {
  const { locale, localizeEntityName, privacyMode, t } = useI18n()
  const eligibleAccounts = accounts.filter(
    (account) => account.isActive && account.type !== 'credit_card',
  )
  const firstEligibleAccountId = eligibleAccounts[0]?.id ?? 0
  const canonicalAccountId = goal?.accountId ?? firstEligibleAccountId
  const canonicalTarget = goal ? formatAmountInput(goal.targetMinor, locale) : ''
  const [draft, setDraft] = useState<EmergencyFundDraft | null>(null)
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [feedback, setFeedback] = useState<LocalizedMessage | null>(null)
  const [feedbackError, setFeedbackError] = useState(false)
  const accountId = draft?.accountId ?? canonicalAccountId
  const target = draft?.target ?? canonicalTarget
  const expectedUpdatedAt = draft ? draft.expectedUpdatedAt : goal?.updatedAt ?? null
  const exists = draft?.exists ?? goal !== null

  function updateDraft(
    change: Partial<Pick<EmergencyFundDraft, 'accountId' | 'target'>>,
    inputLocale?: EmergencyFundDraft['locale'],
  ) {
    setDraft((current) => ({
      accountId: current?.accountId ?? canonicalAccountId,
      target: current?.target ?? canonicalTarget,
      locale: inputLocale ?? current?.locale ?? locale,
      expectedUpdatedAt: current ? current.expectedUpdatedAt : goal?.updatedAt ?? null,
      exists: current?.exists ?? goal !== null,
      ...change,
    }))
  }

  async function saveGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!enabled || busy || accountId <= 0) return

    let targetMinor: number
    try {
      targetMinor = parseAmount(target, draft?.locale ?? locale)
    } catch {
      setFeedback(message('invalidAmount'))
      setFeedbackError(true)
      return
    }

    setBusy('save')
    setFeedback(null)
    setFeedbackError(false)
    try {
      const saved = await api<EmergencyFundGoal>('/api/emergency-fund-goal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, targetMinor, expectedUpdatedAt }),
      })
      const refreshed = await onRefresh()
      setDraft(refreshed ? null : {
        accountId: saved.accountId,
        target: formatAmountInput(saved.targetMinor, locale),
        locale,
        expectedUpdatedAt: saved.updatedAt,
        exists: true,
      })
      setFeedback(message(refreshed ? 'emergencyFundGoalSaved' : 'savedRefreshFailed'))
    } catch (error) {
      setFeedback(messageForError(error, 'emergencyFundGoalSaveFailed'))
      setFeedbackError(true)
    } finally {
      setBusy(null)
    }
  }

  async function deleteGoal() {
    if (!enabled || busy || !exists || !expectedUpdatedAt) return
    if (!window.confirm(t('deleteEmergencyFundGoalConfirm'))) return

    setBusy('delete')
    setFeedback(null)
    setFeedbackError(false)
    try {
      await api<{ deleted: true }>('/api/emergency-fund-goal', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt }),
      })
      const refreshed = await onRefresh()
      setDraft(refreshed ? null : {
        accountId: firstEligibleAccountId,
        target: '',
        locale,
        expectedUpdatedAt: null,
        exists: false,
      })
      setFeedback(message(refreshed ? 'emergencyFundGoalDeleted' : 'savedRefreshFailed'))
    } catch (error) {
      setFeedback(messageForError(error, 'emergencyFundGoalDeleteFailed'))
      setFeedbackError(true)
    } finally {
      setBusy(null)
    }
  }

  const disabled = !enabled || busy !== null || eligibleAccounts.length === 0

  return (
    <section className="settings-panel emergency-fund-settings" aria-labelledby="emergency-fund-settings-title">
      <div className="settings-panel-heading emergency-fund-settings-heading">
        <span className="settings-panel-icon" aria-hidden="true"><PiggyBank /></span>
        <div>
          <h3 id="emergency-fund-settings-title">{t('emergencyFundSettingsTitle')}</h3>
          <p>{t('emergencyFundSettingsHelp')}</p>
        </div>
      </div>

      <form className="emergency-fund-form" onSubmit={saveGoal} aria-busy={busy !== null}>
        <fieldset disabled={disabled}>
          <label>
            <span>{t('emergencyFundAccountLabel')}</span>
            <select
              value={accountId || ''}
              onChange={(event) => updateDraft({ accountId: Number(event.target.value) })}
              aria-describedby="emergency-fund-account-help"
              required
            >
              {eligibleAccounts.length === 0 ? <option value="">—</option> : null}
              {eligibleAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {localizeEntityName(account.name, account.localizationKey)}
                </option>
              ))}
            </select>
            <small id="emergency-fund-account-help">{t('emergencyFundAccountFieldHelp')}</small>
          </label>

          <label>
            <span>{t('emergencyFundTargetLabel')}</span>
            <input
              type={privacyMode ? 'password' : 'text'}
              inputMode="decimal"
              autoComplete="off"
              value={target}
              onChange={(event) => {
                const nextTarget = event.target.value
                updateDraft(
                  { target: nextTarget },
                  resolveAmountInputLocale(nextTarget, locale, draft?.locale),
                )
              }}
              placeholder={t('emergencyFundTargetPlaceholder')}
              aria-describedby="emergency-fund-target-help"
              required
            />
            <small id="emergency-fund-target-help">{t('emergencyFundTargetFieldHelp')}</small>
          </label>
        </fieldset>

        {!enabled ? <p className="emergency-fund-settings-unavailable">{t('emergencyFundGoalUnavailable')}</p> : null}
        {eligibleAccounts.length === 0 ? (
          <p className="emergency-fund-settings-unavailable">{t('emergencyFundNoEligibleAccounts')}</p>
        ) : null}

        <div className="emergency-fund-form-actions">
          <button className="button button-primary" type="submit" disabled={disabled || !target.trim()}>
            {busy === 'save' ? t('saving') : t('saveEmergencyFundGoal')}
          </button>
          <button
            className="button button-danger"
            type="button"
            onClick={() => void deleteGoal()}
            disabled={!enabled || busy !== null || !exists}
          >
            <Trash2 aria-hidden="true" />
            {t('deleteEmergencyFundGoal')}
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
