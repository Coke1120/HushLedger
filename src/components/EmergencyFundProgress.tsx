import { PiggyBank, Settings2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { calculateEmergencyFundProgress } from '../lib/emergencyFund'
import type { AccountBalance, EmergencyFundGoal } from '../lib/schema'

type EmergencyFundProgressProps = {
  goal: EmergencyFundGoal | null
  balance: AccountBalance | null
  month: string
  loading: boolean
  canManage: boolean
  onManage: () => void
}

export function EmergencyFundProgress({
  goal,
  balance,
  month,
  loading,
  canManage,
  onManage,
}: EmergencyFundProgressProps) {
  const {
    formatMoney,
    formatMonth,
    formatNumber,
    localizeEntityName,
    privacyMode,
    t,
  } = useI18n()
  const progress = goal
    ? calculateEmergencyFundProgress(balance?.recordedBalance ?? null, goal.targetMinor)
    : null
  const formattedMonth = formatMonth(month)

  return (
    <section
      className="category-spending-panel emergency-fund-panel"
      aria-labelledby="emergency-fund-title"
      aria-busy={loading}
    >
      <header className="category-spending-heading">
        <span className="category-spending-heading-icon emergency-fund-heading-icon" aria-hidden="true">
          <PiggyBank />
        </span>
        <div>
          <h2 id="emergency-fund-title">{t('emergencyFundTitle')}</h2>
          <p>{t('emergencyFundHelp', { month: formattedMonth })}</p>
        </div>
      </header>

      {loading ? (
        <p className="category-spending-empty" role="status">{t('emergencyFundLoading')}</p>
      ) : !goal ? (
        <div className="emergency-fund-empty">
          <div>
            <strong>{t('emergencyFundEmptyTitle')}</strong>
            <p>{t('emergencyFundEmptyHelp')}</p>
          </div>
          <button
            className="button button-primary"
            type="button"
            onClick={onManage}
            disabled={!canManage}
          >
            <Settings2 aria-hidden="true" />
            {t('emergencyFundSetUp')}
          </button>
          {!canManage ? <p className="emergency-fund-unavailable">{t('emergencyFundGoalUnavailable')}</p> : null}
        </div>
      ) : (
        <div className="emergency-fund-body">
          <div className="emergency-fund-account">
            <span>{t('emergencyFundAccount')}</span>
            <strong>
              {balance
                ? localizeEntityName(balance.accountName, balance.accountLocalizationKey)
                : t('unknownAccount')}
            </strong>
          </div>

          {progress?.basisPoints === null ? (
            <p className="emergency-fund-unavailable">
              {t('emergencyFundUnavailable', { month: formattedMonth })}
            </p>
          ) : (
            <>
              <dl className="emergency-fund-values">
                <div>
                  <dt>{t('recordedBalance')}</dt>
                  <dd>{formatMoney(balance?.recordedBalance ?? 0)}</dd>
                </div>
                <div>
                  <dt>{t('emergencyFundTarget')}</dt>
                  <dd>{formatMoney(goal.targetMinor)}</dd>
                </div>
                <div>
                  <dt>{t('emergencyFundGap')}</dt>
                  <dd>{formatMoney(progress?.remainingMinor ?? 0)}</dd>
                </div>
              </dl>

              <div className="emergency-fund-progress-copy">
                <span>{t('emergencyFundProgress')}</span>
                <strong>
                  {privacyMode
                    ? t('sensitiveTextHidden')
                    : t('emergencyFundProgressValue', {
                      percent: formatNumber((progress?.basisPoints ?? 0) / 100),
                    })}
                </strong>
              </div>
              <div
                className={`emergency-fund-progress-track${privacyMode ? ' is-private' : ''}`}
                aria-hidden="true"
              >
                <span
                  className="emergency-fund-progress-fill"
                  style={privacyMode
                    ? undefined
                    : { width: `${(progress?.basisPoints ?? 0) / 100}%` }}
                />
              </div>
              {!privacyMode && progress?.complete ? (
                <p className="emergency-fund-reached">{t('emergencyFundReached')}</p>
              ) : null}
            </>
          )}

          <p className="emergency-fund-note">{t('emergencyFundRecordedNote')}</p>
          <button
            className="button button-secondary emergency-fund-manage"
            type="button"
            onClick={onManage}
            disabled={!canManage}
          >
            <Settings2 aria-hidden="true" />
            {t('emergencyFundManage')}
          </button>
        </div>
      )}
    </section>
  )
}
