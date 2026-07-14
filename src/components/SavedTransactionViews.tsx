import { BookmarkPlus, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useI18n, type MessageKey } from '../i18n'
import {
  MAX_SAVED_TRANSACTION_VIEWS,
  type SavedTransactionView,
} from '../lib/savedTransactionViews'
import type { Account, Category } from '../lib/schema'

const sortMessageKeys = {
  date_desc: 'sortDateNewest',
  date_asc: 'sortDateOldest',
  amount_desc: 'sortAmountLargest',
  amount_asc: 'sortAmountSmallest',
  payee_asc: 'sortPayeeAscending',
  payee_desc: 'sortPayeeDescending',
} satisfies Record<SavedTransactionView['sort'], MessageKey>

type SavedTransactionViewsProps = {
  views: SavedTransactionView[]
  accounts: Account[]
  categories: Category[]
  canSave: boolean
  onSave: (name: string) => void
  onApply: (view: SavedTransactionView) => void
  onDelete: (id: string) => void
  onReset: () => void
}

export function SavedTransactionViews({
  views,
  accounts,
  categories,
  canSave,
  onSave,
  onApply,
  onDelete,
  onReset,
}: SavedTransactionViewsProps) {
  const { formatMoney, localizeEntityName, privacyMode, t } = useI18n()
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [messageKey, setMessageKey] = useState<MessageKey | null>(null)

  const describe = (view: SavedTransactionView) => {
    const parts: string[] = []
    if (view.scope === 'all') parts.push(t('allHistory'))
    if (view.scope === 'range' && view.dateFrom && view.dateTo) {
      parts.push(t('savedViewDateRange', { from: view.dateFrom, to: view.dateTo }))
    }
    if (view.type !== 'all') parts.push(t(view.type))
    if (view.status !== 'all') parts.push(t(view.status))
    if (view.accountId !== null) {
      const account = accounts.find(({ id }) => id === view.accountId)
      parts.push(account
        ? localizeEntityName(account.name, account.localizationKey)
        : t('savedViewMissingReference'))
    }
    if (view.categoryId !== null) {
      const category = categories.find(({ id }) => id === view.categoryId)
      parts.push(category
        ? localizeEntityName(category.name, category.localizationKey)
        : t('savedViewMissingReference'))
    }
    if (view.payee) parts.push(t('savedViewPayee', { payee: view.payee }))
    if (view.search) parts.push(t('savedViewSearch', { search: view.search }))
    if (view.amountMinor !== null) {
      parts.push(t('savedViewExactAmount', {
        amount: privacyMode ? t('sensitiveTextHidden') : formatMoney(view.amountMinor),
      }))
    }
    if (view.tag) parts.push(view.tag)
    if (view.duplicates) parts.push(t('savedViewPossibleDuplicates'))
    if (view.sort !== 'date_desc') parts.push(t(sortMessageKeys[view.sort]))
    return parts.join(' · ')
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedName = name.trim()
    if (!normalizedName) {
      setMessageKey('savedViewNameRequired')
      return
    }
    if (views.some((view) => view.name.toLowerCase() === normalizedName.toLowerCase())) {
      setMessageKey('savedViewNameDuplicate')
      return
    }
    if (views.length >= MAX_SAVED_TRANSACTION_VIEWS) {
      setMessageKey('savedViewLimitReached')
      return
    }
    onSave(normalizedName)
    setName('')
    setFormOpen(false)
    setMessageKey('savedViewSaved')
  }

  return (
    <details className="saved-transaction-views">
      <summary>
        <span className="saved-transaction-views-heading">
          <strong>{t('savedViewsTitle')}</strong>
          <small>{t('savedViewsHelp')}</small>
        </span>
        <span className="saved-transaction-views-count">
          {t('savedViewCount', { count: views.length, max: MAX_SAVED_TRANSACTION_VIEWS })}
        </span>
      </summary>
      <div className="saved-transaction-views-content">
        <div className="saved-transaction-view-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={!canSave || views.length >= MAX_SAVED_TRANSACTION_VIEWS}
            onClick={() => {
              setFormOpen(true)
              setMessageKey(null)
            }}
            title={!canSave ? t('savedViewNothingToSave') : undefined}
          >
            <BookmarkPlus aria-hidden="true" />
            {t('saveCurrentView')}
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={!canSave}
            onClick={() => {
              onReset()
              setMessageKey(null)
            }}
          >
            <RotateCcw aria-hidden="true" />
            {t('resetTransactionFilters')}
          </button>
        </div>

        {formOpen ? (
          <form className="saved-transaction-view-form" onSubmit={submit}>
            <label>
              <span>{t('savedViewName')}</span>
              <input
                autoFocus
                value={name}
                maxLength={40}
                onChange={(event) => {
                  setName(event.target.value)
                  setMessageKey(null)
                }}
                placeholder={t('savedViewNameExample')}
              />
            </label>
            <button className="button button-primary" type="submit">{t('save')}</button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setFormOpen(false)
                setName('')
                setMessageKey(null)
              }}
            >
              {t('cancel')}
            </button>
          </form>
        ) : null}

        {views.length > 0 ? (
          <div className="saved-transaction-view-list">
            {views.map((view) => (
              <div className="saved-transaction-view" key={view.id}>
                <button type="button" onClick={() => onApply(view)}>
                  <strong>{view.name}</strong>
                  <small>{describe(view)}</small>
                </button>
                <button
                  className="saved-transaction-view-delete"
                  type="button"
                  aria-label={t('deleteSavedView', { name: view.name })}
                  title={t('deleteSavedView', { name: view.name })}
                  onClick={() => {
                    if (window.confirm(t('deleteSavedViewConfirm', { name: view.name }))) {
                      onDelete(view.id)
                      setMessageKey('savedViewDeleted')
                    }
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="saved-transaction-view-empty">{t('noSavedViews')}</p>
        )}

        <p className="saved-transaction-view-status" aria-live="polite" aria-atomic="true">
          {messageKey ? t(messageKey) : ''}
        </p>
      </div>
    </details>
  )
}
