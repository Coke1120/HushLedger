import {
  AlertTriangle,
  Banknote,
  Check,
  Circle,
  CircleCheck,
  CircleDollarSign,
  CircleEllipsis,
  Gamepad2,
  HeartPulse,
  House,
  ReceiptText,
  Repeat,
  ListChecks,
  ShoppingBag,
  Train,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import type { Category, Transaction } from '../lib/schema'
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
  categories: Category[]
  loading: boolean
  tagFilter: string | null
  duplicateReview: boolean
  allowBulkActions: boolean
  saving: boolean
  onEdit: (transaction: Transaction) => void
  onTagSelect: (tag: string | null) => void
  onSetCategory: (transactions: Transaction[], categoryId: number) => Promise<boolean>
  onSetClearing: (transactions: Transaction[], cleared: boolean) => Promise<boolean>
}

export function TransactionList({
  transactions,
  categories,
  loading,
  tagFilter,
  duplicateReview,
  allowBulkActions,
  saving,
  onEdit,
  onTagSelect,
  onSetCategory,
  onSetClearing,
}: TransactionListProps) {
  const { formatDate, formatMoney, localizeEntityName, t } = useI18n()
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkCategoryId, setBulkCategoryId] = useState<number | null>(null)
  const [applying, setApplying] = useState(false)

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

  const selectedTransactions = transactions.filter(({ id }) => selectedIds.has(id))
  const allSelected = selectedTransactions.length === transactions.length
  const busy = saving || applying
  const selectedType = selectedTransactions.length > 0
    && selectedTransactions.every(({ type }) => type === selectedTransactions[0]?.type)
    ? selectedTransactions[0]!.type
    : null
  const availableCategories = selectedType
    ? categories.filter(({ isActive, type }) => isActive && type === selectedType)
    : []
  const selectedCategoryIsValid = availableCategories.some(({ id }) => id === bulkCategoryId)

  const finishSelecting = () => {
    setSelecting(false)
    setSelectedIds(new Set())
    setBulkCategoryId(null)
  }

  const applyClearing = async (cleared: boolean) => {
    if (busy || selectedTransactions.length === 0) return
    setApplying(true)
    try {
      if (await onSetClearing(selectedTransactions, cleared)) finishSelecting()
    } finally {
      setApplying(false)
    }
  }

  const applyCategory = async () => {
    if (busy || selectedTransactions.length === 0 || !selectedCategoryIsValid || bulkCategoryId === null) return
    setApplying(true)
    try {
      if (await onSetCategory(selectedTransactions, bulkCategoryId)) finishSelecting()
    } finally {
      setApplying(false)
    }
  }

  return (
    <>
      {allowBulkActions ? (
        <div
          className={`transaction-bulk-toolbar${selecting ? ' is-active' : ''}`}
          role="toolbar"
          aria-label={t('transactionBulkActions')}
        >
          {selecting ? (
            <>
              <span className="transaction-selected-count" role="status" aria-live="polite">
                {t(
                  selectedTransactions.length === 1
                    ? 'selectedTransactionCountOne'
                    : 'selectedTransactionCount',
                  { count: selectedTransactions.length },
                )}
              </span>
              <div className="transaction-bulk-buttons">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => setSelectedIds(
                    allSelected ? new Set() : new Set(transactions.map(({ id }) => id)),
                  )}
                >
                  <ListChecks aria-hidden="true" />
                  {t(allSelected ? 'clearTransactionSelection' : 'selectAllShownTransactions')}
                </button>
                <div className="transaction-bulk-category">
                  <label>
                    <span className="sr-only">{t('changeSelectedCategory')}</span>
                    <select
                      value={bulkCategoryId ?? ''}
                      onChange={(event) => setBulkCategoryId(
                        event.target.value ? Number(event.target.value) : null,
                      )}
                      disabled={busy || selectedType === null}
                      title={selectedTransactions.length > 0 && selectedType === null
                        ? t('selectSameTypeForCategory')
                        : t('changeSelectedCategory')}
                    >
                      <option value="">
                        {t(selectedTransactions.length > 0 && selectedType === null
                          ? 'selectSameTypeForCategory'
                          : 'changeSelectedCategory')}
                      </option>
                      {availableCategories.map((category) => (
                        <option value={category.id} key={category.id}>
                          {localizeEntityName(category.name, category.localizationKey)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={busy || !selectedCategoryIsValid}
                    onClick={() => void applyCategory()}
                  >
                    {t('applySelectedCategory')}
                  </button>
                </div>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy || selectedTransactions.length === 0}
                  onClick={() => void applyClearing(true)}
                >
                  <CircleCheck aria-hidden="true" />
                  {t('markSelectedCleared')}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy || selectedTransactions.length === 0}
                  onClick={() => void applyClearing(false)}
                >
                  <Circle aria-hidden="true" />
                  {t('markSelectedUncleared')}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={finishSelecting}
                >
                  {t('cancel')}
                </button>
              </div>
            </>
          ) : (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setSelecting(true)}
            >
              <ListChecks aria-hidden="true" />
              {t('selectTransactions')}
            </button>
          )}
        </div>
      ) : null}
      <ul className={`transaction-list${selecting ? ' is-selecting' : ''}`} aria-label={t('transactionList')}>
      {transactions.map((transaction) => {
        const Icon = iconMap[transaction.categoryIcon] ?? CircleEllipsis
        const categoryName = localizeEntityName(transaction.categoryName, transaction.categoryLocalizationKey)
        const accountName = localizeEntityName(transaction.accountName, transaction.accountLocalizationKey)
        const title = transaction.payee || categoryName
        const generatedLabel = t('generatedByRule', { name: transaction.recurringRuleName ?? t('unnamedRule') })
        const tags = transactionTagsFromNote(transaction.note)
        const selected = selectedIds.has(transaction.id)
        return (
          <li className="transaction-list-item" key={transaction.id}>
            <button
              className={`transaction-row${selected ? ' is-selected' : ''}`}
              type="button"
              aria-label={selecting ? t(selected ? 'deselectTransaction' : 'selectTransaction', { name: title }) : undefined}
              aria-pressed={selecting ? selected : undefined}
              onClick={() => {
                if (!selecting) {
                  onEdit(transaction)
                  return
                }
                setSelectedIds((current) => {
                  const next = new Set(current)
                  if (next.has(transaction.id)) next.delete(transaction.id)
                  else next.add(transaction.id)
                  return next
                })
              }}
            >
              {selecting ? null : <span className="sr-only">{t('edit')}</span>}
              {selecting ? (
                <span className={`transaction-selection-indicator${selected ? ' is-selected' : ''}`} aria-hidden="true">
                  {selected ? <Check /> : null}
                </span>
              ) : (
                <span
                  className="category-icon"
                  style={{ color: transaction.categoryColor, backgroundColor: `${transaction.categoryColor}18` }}
                  aria-hidden="true"
                >
                  <Icon />
                </span>
              )}
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
                {formatMoney(transaction.amountMinor, transaction.currency)}
              </strong>
            </button>
            {!selecting && tags.length > 0 ? (
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
    </>
  )
}
