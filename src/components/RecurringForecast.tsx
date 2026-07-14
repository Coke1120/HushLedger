import { ArrowRightLeft, CalendarClock, Repeat2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import {
  recurringForecastOccurrences,
  recurringForecastPeriods,
  recurringTransferForecastOccurrences,
  summarizeRecurringForecast,
} from '../lib/recurringForecast'
import type { Summary } from '../lib/schema'

type RecurringForecastProps = {
  summary: Summary
  accounts: readonly ForecastReference[]
  categories: readonly ForecastReference[]
  loading: boolean
  onManage: (recurringRuleId: string) => void
  onManageTransfer: (recurringTransferRuleId: string) => void
}

type ForecastReference = {
  id: number
  name: string
  localizationKey: string | null
}

const visibleOccurrenceLimit = 6
const privacyTotalsPlaceholder = {
  incomeMinor: 0,
  expenseMinor: 0,
  netMinor: 0,
}

function previousCalendarDate(date: string) {
  const previous = new Date(`${date}T00:00:00.000Z`)
  previous.setUTCDate(previous.getUTCDate() - 1)
  return previous.toISOString().slice(0, 10)
}

export function RecurringForecast({
  summary,
  accounts,
  categories,
  loading,
  onManage,
  onManageTransfer,
}: RecurringForecastProps) {
  const { formatDate, formatMoney, localizeEntityName, privacyMode, t } = useI18n()
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)
  const [expandedTransferMonth, setExpandedTransferMonth] = useState<string | null>(null)
  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  )
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const showAll = expandedMonth === summary.month
  const occurrences = recurringForecastOccurrences(summary.recurringForecast)
  const transferOccurrences = recurringTransferForecastOccurrences(
    summary.recurringTransferForecast ?? [],
  )
  const hiddenOccurrenceCount = Math.max(0, occurrences.length - visibleOccurrenceLimit)
  const visibleOccurrences = showAll
    ? occurrences
    : occurrences.slice(0, visibleOccurrenceLimit)
  const showAllTransfers = expandedTransferMonth === summary.month
  const hiddenTransferOccurrenceCount = Math.max(
    0,
    transferOccurrences.length - visibleOccurrenceLimit,
  )
  const visibleTransferOccurrences = showAllTransfers
    ? transferOccurrences
    : transferOccurrences.slice(0, visibleOccurrenceLimit)
  const totals = summarizeRecurringForecast(summary.recurringForecast)
  const displayedTotals = totals ?? (privacyMode ? privacyTotalsPlaceholder : null)
  const periods = recurringForecastPeriods(summary.month, summary.recurringForecast)
    .filter(({ startOn, endOnExclusive }) => startOn < endOnExclusive)

  return (
    <section
      className="category-spending-panel recurring-forecast-panel"
      aria-labelledby="recurring-forecast-title"
      aria-busy={loading}
    >
      <header className="category-spending-heading">
        <span className="category-spending-heading-icon recurring-forecast-heading-icon" aria-hidden="true">
          <CalendarClock />
        </span>
        <div>
          <h2 id="recurring-forecast-title">{t('scheduledThisMonth')}</h2>
          <p>{t('scheduledThisMonthHelp')}</p>
        </div>
      </header>

      {loading ? (
        <p className="category-spending-empty" role="status">{t('scheduledForecastLoading')}</p>
      ) : visibleOccurrences.length === 0 && transferOccurrences.length === 0 ? (
        <div className="category-spending-empty">
          <strong>{t('noScheduledThisMonth')}</strong>
          <span>{t('noScheduledThisMonthHelp')}</span>
        </div>
      ) : (
        <>
          {visibleOccurrences.length > 0 && displayedTotals ? (
            <dl className="recurring-forecast-totals">
              <div className="recurring-forecast-total income">
                <dt>{t('scheduledIncome')}</dt>
                <dd>{formatMoney(displayedTotals.incomeMinor)}</dd>
              </div>
              <div className="recurring-forecast-total expense">
                <dt>{t('scheduledExpense')}</dt>
                <dd>{formatMoney(displayedTotals.expenseMinor)}</dd>
              </div>
              <div className="recurring-forecast-total net">
                <dt>{t('scheduledNet')}</dt>
                <dd>{formatMoney(displayedTotals.netMinor)}</dd>
              </div>
            </dl>
          ) : null}
          {visibleOccurrences.length > 0 ? <section
            className="recurring-forecast-periods"
            aria-labelledby="recurring-forecast-periods-title"
          >
            <header className="recurring-forecast-periods-heading">
              <h3 id="recurring-forecast-periods-title">{t('scheduledCashFlowByWeek')}</h3>
              <p>{t('scheduledCashFlowByWeekHelp')}</p>
            </header>
            <ol className="recurring-forecast-period-list">
              {periods.map((period) => {
                const inclusiveEndOn = previousCalendarDate(period.endOnExclusive)
                const formattedStartOn = formatDate(period.startOn)
                const formattedEndOn = formatDate(inclusiveEndOn)
                const rangeLabel = period.startOn === inclusiveEndOn
                  ? formattedStartOn
                  : t('savedViewDateRange', { from: formattedStartOn, to: formattedEndOn })
                const displayedPeriodTotals = period.totals
                  ?? (privacyMode ? privacyTotalsPlaceholder : null)
                const netClassName = !privacyMode && period.totals
                  ? period.totals.netMinor > 0
                    ? 'income'
                    : period.totals.netMinor < 0
                      ? 'expense'
                      : undefined
                  : undefined

                return (
                  <li className="recurring-forecast-period" key={period.index}>
                    <h4 className="recurring-forecast-period-range" aria-label={rangeLabel}>
                      <time dateTime={period.startOn}>{formattedStartOn}</time>
                      {period.startOn === inclusiveEndOn ? null : (
                        <>
                          <span aria-hidden="true">–</span>
                          <time dateTime={inclusiveEndOn}>{formattedEndOn}</time>
                        </>
                      )}
                    </h4>
                    {displayedPeriodTotals ? (
                      <dl className="recurring-forecast-period-totals">
                        <div className="recurring-forecast-period-total income">
                          <dt>{t('scheduledIncome')}</dt>
                          <dd>{formatMoney(displayedPeriodTotals.incomeMinor)}</dd>
                        </div>
                        <div className="recurring-forecast-period-total expense">
                          <dt>{t('scheduledExpense')}</dt>
                          <dd>{formatMoney(displayedPeriodTotals.expenseMinor)}</dd>
                        </div>
                        <div className="recurring-forecast-period-total">
                          <dt>{t('scheduledNet')}</dt>
                          <dd className={netClassName}>{formatMoney(displayedPeriodTotals.netMinor)}</dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="recurring-forecast-period-unavailable">
                        {t('scheduledPeriodTotalsUnavailable')}
                      </p>
                    )}
                  </li>
                )
              })}
            </ol>
          </section> : null}
          {visibleOccurrences.length > 0 ? <ol className="category-spending-list" id="recurring-forecast-list">
            {visibleOccurrences.map((occurrence) => {
              const date = formatDate(occurrence.occurrenceOn)
              const amount = formatMoney(occurrence.amountMinor)
              const hasReferenceContext = occurrence.accountId !== undefined
                && occurrence.categoryId !== undefined
              const account = occurrence.accountId === undefined
                ? undefined
                : accountsById.get(occurrence.accountId)
              const category = occurrence.categoryId === undefined
                ? undefined
                : categoriesById.get(occurrence.categoryId)
              const accountName = account
                ? localizeEntityName(account.name, account.localizationKey)
                : t('unknownAccount')
              const categoryName = category
                ? localizeEntityName(category.name, category.localizationKey)
                : t('unknownCategory')
              const referenceContext = hasReferenceContext
                ? `${accountName} · ${categoryName}`
                : null
              const manageLabel = t('manageScheduledRule', {
                name: occurrence.name,
                date,
                amount,
                type: t(occurrence.type),
              })

              return (
                <li key={`${occurrence.recurringRuleId}:${occurrence.occurrenceOn}`}>
                  <button
                    className="category-spending-row recurring-forecast-row"
                    type="button"
                    data-recurring-rule-id={occurrence.recurringRuleId}
                    onClick={() => onManage(occurrence.recurringRuleId)}
                    aria-label={referenceContext
                      ? `${manageLabel} ${t('accountAndCategory')}: ${referenceContext}.`
                      : manageLabel}
                  >
                    <span className="category-spending-name">
                      <span
                        className={`recurring-forecast-rule-icon ${occurrence.type}`}
                        aria-hidden="true"
                      >
                        <Repeat2 />
                      </span>
                      <span>
                        <strong>{occurrence.name}</strong>
                        <small>
                          <time dateTime={occurrence.occurrenceOn}>{date}</time>
                          {occurrence.payee ? ` · ${occurrence.payee}` : ''}
                          {' · '}{t(occurrence.frequency)}
                        </small>
                        {referenceContext ? (
                          <small className="recurring-forecast-reference">{referenceContext}</small>
                        ) : null}
                      </span>
                    </span>
                    <span className="category-spending-amount">
                      <strong className={occurrence.type}>
                        {occurrence.type === 'income' ? '+' : '−'}{amount}
                      </strong>
                      <small>{t(occurrence.type)}</small>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol> : null}
          {visibleOccurrences.length > 0 && hiddenOccurrenceCount > 0 ? (
            <div className="recurring-forecast-actions">
              <button
                className="button button-secondary"
                type="button"
                aria-controls="recurring-forecast-list"
                aria-expanded={showAll}
                onClick={() => setExpandedMonth(showAll ? null : summary.month)}
              >
                {showAll
                  ? t('showFewerScheduledEntries')
                  : t('showMoreScheduledEntries', { count: hiddenOccurrenceCount })}
              </button>
            </div>
          ) : null}
          {transferOccurrences.length > 0 ? (
            <section
              className="recurring-transfer-forecast"
              aria-labelledby="recurring-transfer-forecast-title"
            >
              <header className="recurring-transfer-forecast-heading">
                <h3 id="recurring-transfer-forecast-title">
                  <ArrowRightLeft aria-hidden="true" />
                  {t('scheduledTransferForecastTitle')}
                </h3>
                <p>{t('scheduledTransferForecastHelp')}</p>
              </header>
              <ol
                className="category-spending-list recurring-transfer-forecast-list"
                id="recurring-transfer-forecast-list"
              >
                {visibleTransferOccurrences.map((occurrence) => {
                  const date = formatDate(occurrence.occurrenceOn)
                  const amount = formatMoney(occurrence.amountMinor)
                  const fromAccountName = localizeEntityName(
                    occurrence.fromAccountName,
                    occurrence.fromAccountLocalizationKey,
                  )
                  const toAccountName = localizeEntityName(
                    occurrence.toAccountName,
                    occurrence.toAccountLocalizationKey,
                  )
                  const direction = t('transferDirection', {
                    from: fromAccountName,
                    to: toAccountName,
                  })
                  const frequency = t(occurrence.frequency)

                  return (
                    <li key={`${occurrence.recurringTransferRuleId}:${occurrence.occurrenceOn}`}>
                      <button
                        className="category-spending-row recurring-forecast-row recurring-transfer-forecast-row"
                        type="button"
                        data-recurring-transfer-rule-id={occurrence.recurringTransferRuleId}
                        onClick={() => onManageTransfer(occurrence.recurringTransferRuleId)}
                        aria-label={t('manageScheduledTransferRule', {
                          name: occurrence.name,
                          date,
                          frequency,
                          amount,
                          from: fromAccountName,
                          to: toAccountName,
                        })}
                      >
                        <span className="category-spending-name">
                          <span className="recurring-forecast-rule-icon transfer" aria-hidden="true">
                            <ArrowRightLeft />
                          </span>
                          <span>
                            <strong>{occurrence.name}</strong>
                            <small>
                              <time dateTime={occurrence.occurrenceOn}>{date}</time>
                              {' · '}{frequency}
                            </small>
                            <small className="recurring-forecast-reference">{direction}</small>
                          </span>
                        </span>
                        <span className="category-spending-amount">
                          <strong>{amount}</strong>
                          <small>{t('scheduledTransferLedgerEntry')}</small>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
              {hiddenTransferOccurrenceCount > 0 ? (
                <div className="recurring-forecast-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    aria-controls="recurring-transfer-forecast-list"
                    aria-expanded={showAllTransfers}
                    onClick={() => setExpandedTransferMonth(
                      showAllTransfers ? null : summary.month,
                    )}
                  >
                    {showAllTransfers
                      ? t('showFewerScheduledTransfers')
                      : t('showMoreScheduledTransfers', {
                        count: hiddenTransferOccurrenceCount,
                      })}
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </section>
  )
}
