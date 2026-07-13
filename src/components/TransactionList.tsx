import {
  AlertTriangle,
  Banknote,
  CircleDollarSign,
  CircleEllipsis,
  Gamepad2,
  HeartPulse,
  House,
  ReceiptText,
  Repeat,
  ShoppingBag,
  Train,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import { useI18n } from '../i18n'
import type { Transaction } from '../lib/schema'
import { transactionTagsFromNote } from '../lib/transactionTags'

const iconMap: Record<string, LucideIcon> = {
  banknote: Banknote,
  'circle-dollar-sign': CircleDollarSign,
  utensils: Utensils,
  train: Train,
  'shopping-bag': ShoppingBag,
  house: House,
  'receipt-text': ReceiptText,
  'gamepad-2': Gamepad2,
  'heart-pulse': HeartPulse,
  'circle-ellipsis': CircleEllipsis,
}

type TransactionListProps = {
  transactions: Transaction[]
  loading: boolean
  tagFilter: string | null
  duplicateReview: boolean
  onEdit: (transaction: Transaction) => void
  onTagSelect: (tag: string | null) => void
}

export function TransactionList({
  transactions,
  loading,
  tagFilter,
  duplicateReview,
  onEdit,
  onTagSelect,
}: TransactionListProps) {
  const { formatDate, formatMoney, localizeEntityName, t } = useI18n()

  if (loading) {
    return (
      <div className="transaction-empty" role="status">
        {t('organizingTransactions')}
      </div>
    )
  }

  if (transactions.length === 0) {
    return (
      <div className="transaction-empty">
        <strong>{t('noTransactions')}</strong>
        <span>{t('noTransactionsHelp')}</span>
      </div>
    )
  }

  return (
    <ul className="transaction-list" aria-label={t('transactionList')}>
      {transactions.map((transaction) => {
        const Icon = iconMap[transaction.categoryIcon] ?? CircleEllipsis
        const categoryName = localizeEntityName(transaction.categoryName, transaction.categoryLocalizationKey)
        const accountName = localizeEntityName(transaction.accountName, transaction.accountLocalizationKey)
        const title = transaction.payee || categoryName
        const generatedLabel = t('generatedByRule', { name: transaction.recurringRuleName ?? t('unnamedRule') })
        const tags = transactionTagsFromNote(transaction.note)
        return (
          <li className="transaction-list-item" key={transaction.id}>
            <button className="transaction-row" type="button" onClick={() => onEdit(transaction)}>
              <span className="sr-only">{t('edit')}</span>
              <span
                className="category-icon"
                style={{ color: transaction.categoryColor, backgroundColor: `${transaction.categoryColor}18` }}
                aria-hidden="true"
              >
                <Icon />
              </span>
              <span className="transaction-main">
                <strong className="transaction-title">
                  <span>{title}</span>
                  {transaction.recurringRuleId ? (
                    <span className="auto-generated-badge" title={generatedLabel}>
                      <Repeat aria-hidden="true" />
                      <span className="sr-only">{generatedLabel}</span>
                    </span>
                  ) : null}
                  {duplicateReview ? (
                    <span className="possible-duplicate-badge" title={t('possibleDuplicateBadge')}>
                      <AlertTriangle aria-hidden="true" />
                      <span className="sr-only">{t('possibleDuplicateBadge')}</span>
                    </span>
                  ) : null}
                </strong>
                <small className="transaction-meta">
                  <span>{categoryName} · {accountName}</span>
                  <span className={`transaction-clearing-status ${transaction.cleared ? 'is-cleared' : 'is-uncleared'}`}>
                    {t(transaction.cleared ? 'cleared' : 'uncleared')}
                  </span>
                </small>
              </span>
              <time dateTime={transaction.occurredOn}>{formatDate(transaction.occurredOn)}</time>
              <strong className={`transaction-amount ${transaction.type}`}>
                <span className="sr-only">{transaction.type === 'income' ? t('income') : t('expense')}</span>
                {transaction.type === 'income' ? '+' : '−'}
                {formatMoney(transaction.amountMinor)}
              </strong>
            </button>
            {tags.length > 0 ? (
              <div className="transaction-tags" aria-label={t('transactionTags')}>
                {tags.map((tag) => {
                  const selected = tag === tagFilter
                  return (
                    <button
                      className={selected ? 'is-active' : undefined}
                      type="button"
                      key={tag}
                      aria-pressed={selected}
                      aria-label={t(selected ? 'removeTagFilter' : 'filterByTag', { tag })}
                      onClick={() => onTagSelect(selected ? null : tag)}
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
