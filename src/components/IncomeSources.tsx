import { CircleDollarSign } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import type { Summary } from '../lib/schema'

type IncomeSourcesProps = {
  summary: Summary
  loading: boolean
  onSelect: (categoryId: number) => void
}

const visibleItemLimit = 5

export function IncomeSources({ summary, loading, onSelect }: IncomeSourcesProps) {
  const { formatMoney, formatMonth, locale, localizeEntityName, privacyMode, t } = useI18n()
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    [locale],
  )
  const sources = summary.incomeByCategory?.map((category) => ({
    ...category,
    name: localizeEntityName(category.categoryName, category.categoryLocalizationKey),
  }))
  const showAll = expandedMonth === summary.month
  const visibleSources = showAll ? sources : sources?.slice(0, visibleItemLimit)
  const hiddenSourceCount = Math.max(0, (sources?.length ?? 0) - visibleItemLimit)

  return (
    <section
      className="category-spending-panel income-sources-panel"
      aria-labelledby="income-sources-title"
      aria-busy={loading}
    >
      <header className="category-spending-heading">
        <span
          className="category-spending-heading-icon income-sources-heading-icon"
          aria-hidden="true"
        >
          <CircleDollarSign />
        </span>
        <div>
          <h2 id="income-sources-title">{t('incomeSourcesTitle')}</h2>
          <p>{t('incomeSourcesHelp', { month: formatMonth(summary.month) })}</p>
        </div>
      </header>

      {loading ? (
        <p className="category-spending-empty" role="status">{t('incomeSourcesLoading')}</p>
      ) : sources === undefined ? (
        <div className="category-spending-empty">
          <strong>{t('incomeSourcesUnavailable')}</strong>
          <span>{t('incomeSourcesUnavailableHelp')}</span>
        </div>
      ) : visibleSources?.length === 0 ? (
        <div className="category-spending-empty">
          <strong>{t('noIncomeSources')}</strong>
          <span>{t('noIncomeSourcesHelp')}</span>
        </div>
      ) : (
        <>
          <ol className="category-spending-list" id="income-sources-list">
            {visibleSources?.map((source) => {
              const share = summary.income > 0 ? source.amountMinor / summary.income : 0
              const percent = percentFormatter.format(share)
              const visiblePercent = privacyMode ? '—' : percent
              const accessibleShare = privacyMode ? t('sensitiveTextHidden') : percent
              const amount = formatMoney(source.amountMinor)
              const transactions = t('transactionCount', { count: source.transactionCount })

              return (
                <li key={source.categoryId}>
                  <button
                    className="category-spending-row"
                    type="button"
                    data-income-category-id={source.categoryId}
                    onClick={() => onSelect(source.categoryId)}
                    aria-label={t('reviewIncomeSource', {
                      name: source.name,
                      amount,
                      share: accessibleShare,
                      transactions,
                    })}
                  >
                    <span className="category-spending-name">
                      <span
                        className="category-spending-dot"
                        style={{ backgroundColor: source.categoryColor }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{source.name}</strong>
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
                          backgroundColor: source.categoryColor,
                        }}
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          {hiddenSourceCount > 0 ? (
            <div className="category-spending-actions">
              <button
                className="button button-secondary"
                type="button"
                aria-controls="income-sources-list"
                aria-expanded={showAll}
                onClick={() => setExpandedMonth(showAll ? null : summary.month)}
              >
                {showAll
                  ? t('showFewerIncomeSources')
                  : t('moreIncomeSources', { count: hiddenSourceCount })}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
