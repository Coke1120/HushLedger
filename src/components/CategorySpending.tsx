import { ChartNoAxesColumnIncreasing } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import { shiftMonth } from '../lib/date'
import type { Summary } from '../lib/schema'

type CategorySpendingProps = {
  summary: Summary
  loading: boolean
  onSelectCategory: (categoryId: number) => void
  onSelectPayee: (payee: string) => void
}

type SpendingBreakdown = 'category' | 'payee'

const visibleItemLimit = 5

export function CategorySpending({
  summary,
  loading,
  onSelectCategory,
  onSelectPayee,
}: CategorySpendingProps) {
  const { formatMoney, formatMonth, locale, localizeEntityName, privacyMode, t } = useI18n()
  const [breakdown, setBreakdown] = useState<SpendingBreakdown>('category')
  const [expandedBreakdown, setExpandedBreakdown] = useState<string | null>(null)
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    [locale],
  )
  const items = breakdown === 'category'
    ? summary.expenseByCategory.map((category) => ({
        key: `category:${category.categoryId}`,
        name: localizeEntityName(category.categoryName, category.categoryLocalizationKey),
        amountMinor: category.amountMinor,
        transactionCount: category.transactionCount,
        previousMonthAmountMinor: category.previousMonthAmountMinor,
        color: category.categoryColor,
        onSelect: () => onSelectCategory(category.categoryId),
      }))
    : summary.expenseByPayee.map((payee) => ({
        key: `payee:${payee.payee}`,
        name: payee.payee,
        amountMinor: payee.amountMinor,
        transactionCount: payee.transactionCount,
        previousMonthAmountMinor: undefined,
        color: 'var(--accent)',
        onSelect: () => onSelectPayee(payee.payee),
      }))
  const payeeBreakdown = breakdown === 'payee'
  const expansionKey = `${summary.month}:${breakdown}`
  const showAll = expandedBreakdown === expansionKey
  const visibleItems = showAll ? items : items.slice(0, visibleItemLimit)
  const hiddenItemCount = Math.max(0, items.length - visibleItemLimit)
  const listId = `category-spending-${breakdown}-list`
  const previousMonth = formatMonth(shiftMonth(summary.month, -1))
  const categoryComparisonAvailable = summary.expenseByCategory.some(
    ({ previousMonthAmountMinor }) => previousMonthAmountMinor !== undefined,
  )

  return (
    <section
      className="category-spending-panel"
      aria-labelledby="category-spending-title"
      aria-busy={loading}
    >
      <header className="category-spending-heading">
        <span className="category-spending-heading-icon" aria-hidden="true">
          <ChartNoAxesColumnIncreasing />
        </span>
        <div>
          <h2 id="category-spending-title">{t('spendingBreakdown')}</h2>
          <p>{t('spendingBreakdownHelp')}</p>
        </div>
      </header>

      <div className="category-spending-switch" aria-label={t('spendingBreakdown')}>
        <button
          type="button"
          aria-pressed={!payeeBreakdown}
          onClick={() => setBreakdown('category')}
        >
          {t('spendingByCategory')}
        </button>
        <button
          type="button"
          aria-pressed={payeeBreakdown}
          onClick={() => setBreakdown('payee')}
        >
          {t('spendingByPayee')}
        </button>
      </div>

      {!loading && !payeeBreakdown && categoryComparisonAvailable ? (
        <p className="category-spending-comparison-help">
          {t('categorySpendingComparisonHelp', { month: previousMonth })}
        </p>
      ) : null}

      {loading ? (
        <p className="category-spending-empty" role="status">{t('categorySpendingLoading')}</p>
      ) : visibleItems.length === 0 ? (
        <div className="category-spending-empty">
          <strong>{t(payeeBreakdown ? 'noPayeeSpending' : 'noCategorySpending')}</strong>
          <span>{t(payeeBreakdown ? 'noPayeeSpendingHelp' : 'noCategorySpendingHelp')}</span>
        </div>
      ) : (
        <>
          <ol className="category-spending-list" id={listId}>
            {visibleItems.map((item) => {
              const share = summary.expense > 0 ? item.amountMinor / summary.expense : 0
              const percent = percentFormatter.format(share)
              const visiblePercent = privacyMode ? '—' : percent
              const accessibleShare = privacyMode ? t('sensitiveTextHidden') : percent
              const amount = formatMoney(item.amountMinor)
              const transactions = t('transactionCount', { count: item.transactionCount })
              const previousAmount = item.previousMonthAmountMinor
              let rawComparison: string | null = null
              if (previousAmount !== undefined) {
                const delta = previousAmount === null ? null : item.amountMinor - previousAmount
                if (delta === null || !Number.isSafeInteger(delta)) {
                  rawComparison = t('categorySpendingComparisonUnavailable')
                } else if (previousAmount === 0) {
                  rawComparison = t('categorySpendingNoPrevious', { month: previousMonth })
                } else if (delta > 0) {
                  rawComparison = t('categorySpendingMoreThanPrevious', {
                    amount: formatMoney(delta),
                    month: previousMonth,
                  })
                } else if (delta < 0) {
                  rawComparison = t('categorySpendingLessThanPrevious', {
                    amount: formatMoney(Math.abs(delta)),
                    month: previousMonth,
                  })
                } else {
                  rawComparison = t('categorySpendingSameAsPrevious', { month: previousMonth })
                }
              }
              const comparison = rawComparison && privacyMode
                ? t('sensitiveTextHidden')
                : rawComparison
              const reviewLabel = t(
                payeeBreakdown ? 'reviewPayeeSpending' : 'reviewCategorySpending',
                {
                  name: item.name,
                  amount,
                  share: accessibleShare,
                  transactions,
                },
              )

              return (
                <li key={item.key}>
                  <button
                    className="category-spending-row"
                    type="button"
                    onClick={item.onSelect}
                    aria-label={comparison ? `${reviewLabel} ${comparison}` : reviewLabel}
                  >
                    <span className="category-spending-name">
                      <span
                        className="category-spending-dot"
                        style={{ backgroundColor: item.color }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{item.name}</strong>
                        <small>{transactions}</small>
                        {comparison ? <small>{comparison}</small> : null}
                      </span>
                    </span>
                    <span className="category-spending-amount">
                      <strong>{amount}</strong>
                      <small aria-hidden={privacyMode}>{visiblePercent}</small>
                    </span>
                    <span className="category-spending-track" aria-hidden="true">
                      <span
                        style={{
                          width: privacyMode ? '0%' : `${Math.min(share * 100, 100)}%`,
                          backgroundColor: item.color,
                        }}
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          {hiddenItemCount > 0 ? (
            <div className="category-spending-actions">
              <button
                className="button button-secondary"
                type="button"
                aria-controls={listId}
                aria-expanded={showAll}
                onClick={() => setExpandedBreakdown(showAll ? null : expansionKey)}
              >
                {showAll
                  ? t(payeeBreakdown
                    ? 'showFewerSpendingPayees'
                    : 'showFewerSpendingCategories')
                  : t(payeeBreakdown ? 'moreSpendingPayees' : 'moreSpendingCategories', {
                    count: hiddenItemCount,
                  })}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
