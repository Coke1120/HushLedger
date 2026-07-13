import { ChartNoAxesColumnIncreasing } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
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
  const { formatMoney, locale, localizeEntityName, privacyMode, t } = useI18n()
  const [breakdown, setBreakdown] = useState<SpendingBreakdown>('category')
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
        color: category.categoryColor,
        onSelect: () => onSelectCategory(category.categoryId),
      }))
    : summary.expenseByPayee.map((payee) => ({
        key: `payee:${payee.payee}`,
        name: payee.payee,
        amountMinor: payee.amountMinor,
        transactionCount: payee.transactionCount,
        color: 'var(--accent)',
        onSelect: () => onSelectPayee(payee.payee),
      }))
  const visibleItems = items.slice(0, visibleItemLimit)
  const remainingItems = items.length - visibleItems.length
  const payeeBreakdown = breakdown === 'payee'

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

      {loading ? (
        <p className="category-spending-empty" role="status">{t('categorySpendingLoading')}</p>
      ) : visibleItems.length === 0 ? (
        <div className="category-spending-empty">
          <strong>{t(payeeBreakdown ? 'noPayeeSpending' : 'noCategorySpending')}</strong>
          <span>{t(payeeBreakdown ? 'noPayeeSpendingHelp' : 'noCategorySpendingHelp')}</span>
        </div>
      ) : (
        <>
          <ol className="category-spending-list">
            {visibleItems.map((item) => {
              const share = summary.expense > 0 ? item.amountMinor / summary.expense : 0
              const percent = percentFormatter.format(share)
              const visiblePercent = privacyMode ? '—' : percent
              const accessibleShare = privacyMode ? t('sensitiveTextHidden') : percent
              const amount = formatMoney(item.amountMinor)
              const transactions = t('transactionCount', { count: item.transactionCount })

              return (
                <li key={item.key}>
                  <button
                    className="category-spending-row"
                    type="button"
                    onClick={item.onSelect}
                    aria-label={t(
                      payeeBreakdown ? 'reviewPayeeSpending' : 'reviewCategorySpending',
                      {
                        name: item.name,
                        amount,
                        share: accessibleShare,
                        transactions,
                      },
                    )}
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
          {remainingItems > 0 ? (
            <p className="category-spending-more">
              {t(payeeBreakdown ? 'moreSpendingPayees' : 'moreSpendingCategories', {
                count: remainingItems,
              })}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
