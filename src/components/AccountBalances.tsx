import { Landmark, List, Scale } from 'lucide-react'
import { useI18n } from '../i18n'
import type { AccountBalance } from '../lib/schema'

type AccountBalancesProps = {
  balances: AccountBalance[]
  month: string
  loading: boolean
  canReconcile: boolean
  onReview: (accountId: number) => void
  onCompare: (accountId: number) => void
}

export function AccountBalances({
  balances,
  month,
  loading,
  canReconcile,
  onReview,
  onCompare,
}: AccountBalancesProps) {
  const { formatMoney, formatMonth, localizeEntityName, t } = useI18n()

  return (
    <section
      className="category-spending-panel account-balances-panel"
      aria-labelledby="account-balances-title"
      aria-busy={loading}
    >
      <header className="category-spending-heading">
        <span className="category-spending-heading-icon account-balances-heading-icon" aria-hidden="true">
          <Landmark />
        </span>
        <div>
          <h2 id="account-balances-title">{t('accountBalancesTitle')}</h2>
          <p>{t('accountBalancesHelp', { month: formatMonth(month) })}</p>
        </div>
      </header>

      {loading ? (
        <p className="category-spending-empty" role="status">{t('accountBalancesLoading')}</p>
      ) : balances.length === 0 ? (
        <div className="category-spending-empty">
          <strong>{t('noAccountBalances')}</strong>
          <span>{t('noAccountBalancesHelp')}</span>
        </div>
      ) : (
        <ul className="account-balances-list">
          {balances.map((account) => {
            const name = localizeEntityName(account.accountName, account.accountLocalizationKey)
            const available = account.recordedBalance !== null
              && account.clearedBalance !== null
              && account.unclearedBalance !== null
            const unclearedCount = account.unclearedCount
            const showUnclearedCount = typeof unclearedCount === 'number'
              && Number.isSafeInteger(unclearedCount)
              && unclearedCount >= 0
            return (
              <li key={account.accountId} className={!account.isActive ? 'is-inactive' : undefined}>
                <div className="account-balance-row">
                  <div className="account-balance-name">
                    <strong>{name}</strong>
                    <span>{account.isActive ? t('active') : t('inactive')}</span>
                  </div>
                  {available ? (
                    <dl className="account-balance-values">
                      <div>
                        <dt>{t('recordedBalance')}</dt>
                        <dd>{formatMoney(account.recordedBalance ?? 0)}</dd>
                      </div>
                      <div>
                        <dt>{t('clearedBalance')}</dt>
                        <dd>{formatMoney(account.clearedBalance ?? 0)}</dd>
                      </div>
                      <div>
                        <dt>{t('unclearedBalance')}</dt>
                        <dd>{formatMoney(account.unclearedBalance ?? 0)}</dd>
                        {showUnclearedCount ? (
                          <>
                            <dt className="account-balance-uncleared-count-label">
                              {t('unclearedThroughMonthEnd')}
                            </dt>
                            <dd className="account-balance-uncleared-count">
                              {t('unclearedCount', { count: unclearedCount })}
                            </dd>
                          </>
                        ) : null}
                      </div>
                    </dl>
                  ) : (
                    <p className="account-balance-unavailable">
                      {t('accountBalanceStartsOn', { date: account.openingBalanceOn ?? '' })}
                    </p>
                  )}
                  <div className="account-balance-actions">
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => onReview(account.accountId)}
                    >
                      <List aria-hidden="true" />
                      {t('reviewAccountActivity')}
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => onCompare(account.accountId)}
                      disabled={!available || !canReconcile}
                      title={!canReconcile ? t('reconciliationUnavailable') : undefined}
                    >
                      <Scale aria-hidden="true" />
                      {t('compareStatement')}
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
