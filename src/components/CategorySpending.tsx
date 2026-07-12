import { ChartNoAxesColumnIncreasing } from 'lucide-react'
import { useMemo } from 'react'
import { useI18n } from '../i18n'
import type { Summary } from '../lib/schema'

type CategorySpendingProps = {
  summary: Summary
  loading: boolean
  onSelect: (categoryId: number) => void
}

const visibleCategoryLimit = 5

export function CategorySpending({ summary, loading, onSelect }: CategorySpendingProps) {
  const { formatMoney, locale, localizeEntityName, privacyMode, t } = useI18n()
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    [locale],
  )
  const visibleCategories = summary.expenseByCategory.slice(0, visibleCategoryLimit)
  const remainingCategories = summary.expenseByCategory.length - visibleCategories.length

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
          <h2 id="category-spending-title">{t('spendingByCategory')}</h2>
          <p>{t('spendingByCategoryHelp')}</p>
        </div>
      </header>

      {loading ? (
        <p className="category-spending-empty" role="status">{t('categorySpendingLoading')}</p>
      ) : visibleCategories.length === 0 ? (
        <div className="category-spending-empty">
          <strong>{t('noCategorySpending')}</strong>
          <span>{t('noCategorySpendingHelp')}</span>
        </div>
      ) : (
        <>
          <ol className="category-spending-list">
            {visibleCategories.map((category) => {
              const name = localizeEntityName(
                category.categoryName,
                category.categoryLocalizationKey,
              )
              const share = summary.expense > 0 ? category.amountMinor / summary.expense : 0
              const percent = percentFormatter.format(share)
              const visiblePercent = privacyMode ? '—' : percent
              const accessibleShare = privacyMode ? t('sensitiveTextHidden') : percent
              const amount = formatMoney(category.amountMinor)
              const transactions = t('transactionCount', { count: category.transactionCount })

              return (
                <li key={category.categoryId}>
                  <button
                    className="category-spending-row"
                    type="button"
                    onClick={() => onSelect(category.categoryId)}
                    aria-label={t('reviewCategorySpending', {
                      name,
                      amount,
                      share: accessibleShare,
                      transactions,
                    })}
                  >
                    <span className="category-spending-name">
                      <span
                        className="category-spending-dot"
                        style={{ backgroundColor: category.categoryColor }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{name}</strong>
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
                          backgroundColor: category.categoryColor,
                        }}
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          {remainingCategories > 0 ? (
            <p className="category-spending-more">
              {t('moreSpendingCategories', { count: remainingCategories })}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
