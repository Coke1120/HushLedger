import { Landmark, Scale } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import { parseSignedAmount } from '../lib/money'
import type { AccountBalance } from '../lib/schema'

type AccountBalancesProps = {
  balances: AccountBalance[]
  month: string
  loading: boolean
}

export function AccountBalances({ balances, month, loading }: AccountBalancesProps) {
  const { formatMoney, formatMonth, locale, localizeEntityName, privacyMode, t } = useI18n()
  const [comparisonAccountId, setComparisonAccountId] = useState<number | null>(null)
  const [statementValue, setStatementValue] = useState('')
  const selected = balances.find(({ accountId }) => accountId === comparisonAccountId)
  const statementMinor = useMemo(() => {
    if (!statementValue.trim()) return null
    try {
      return parseSignedAmount(statementValue, locale)
    } catch {
      return undefined
    }
  }, [locale, statementValue])
  const difference = selected?.clearedBalance !== null
    && selected?.clearedBalance !== undefined
    && typeof statementMinor === 'number'
    ? statementMinor - selected.clearedBalance
    : null

  function compare(accountId: number) {
    setComparisonAccountId((current) => current === accountId ? null : accountId)
    setStatementValue('')
  }

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
            const comparing = comparisonAccountId === account.accountId
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
                      </div>
                    </dl>
                  ) : (
                    <p className="account-balance-unavailable">
                      {t('accountBalanceStartsOn', { date: account.openingBalanceOn ?? '' })}
                    </p>
                  )}
                  <button
                    className="button button-secondary account-reconcile-button"
                    type="button"
                    onClick={() => compare(account.accountId)}
                    disabled={!available}
                    aria-expanded={comparing}
                  >
                    <Scale aria-hidden="true" />
                    {comparing ? t('closeStatementComparison') : t('compareStatement')}
                  </button>
                </div>

                {comparing && available ? (
                  <div className="statement-comparison">
                    <label>
                      <span>{t('statementEndingBalance')}</span>
                      <input
                        type={privacyMode ? 'password' : 'text'}
                        inputMode="decimal"
                        value={statementValue}
                        onChange={(event) => setStatementValue(event.target.value)}
                        placeholder={t('statementBalancePlaceholder')}
                        autoFocus
                      />
                    </label>
                    <div className="statement-comparison-result" aria-live="polite">
                      {statementMinor === undefined ? (
                        <span className="is-error">{t('invalidStatementBalance')}</span>
                      ) : difference === null ? (
                        <span>{t('statementComparisonHelp')}</span>
                      ) : difference === 0 ? (
                        <strong className="is-match">{t('statementBalancesMatch')}</strong>
                      ) : (
                        <strong>{t('statementDifference', { amount: formatMoney(difference) })}</strong>
                      )}
                    </div>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
