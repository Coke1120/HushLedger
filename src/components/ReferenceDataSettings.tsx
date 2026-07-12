import { Pencil, Plus, RotateCcw, Tags, WalletCards } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import {
  createAccountAction,
  createCategoryAction,
  setAccountStatusAction,
  setCategoryStatusAction,
  updateAccountAction,
  updateCategoryAction,
} from '../app/actions'
import { actionData } from '../hooks/actionResult'
import {
  message,
  messageForError,
  renderMessage,
  useI18n,
  type LocalizedMessage,
  type MessageKey,
} from '../i18n'
import type { Account, AccountType, Category, TransactionType } from '../lib/schema'

type ReferenceDataSettingsProps = {
  accounts: Account[]
  categories: Category[]
  enabled: boolean
  onRefresh: () => Promise<boolean>
}

type Editor =
  | {
      kind: 'account'
      id: number
      name: string
      originalDisplayName: string
      rawName: string
      type: AccountType
      originalType: AccountType
      updatedAt: string
    }
  | {
      kind: 'category'
      id: number
      name: string
      originalDisplayName: string
      rawName: string
      updatedAt: string
    }

export function ReferenceDataSettings({
  accounts,
  categories,
  enabled,
  onRefresh,
}: ReferenceDataSettingsProps) {
  const { localizeEntityName, t } = useI18n()
  const [accountName, setAccountName] = useState('')
  const [accountType, setAccountType] = useState<AccountType>('bank')
  const [categoryName, setCategoryName] = useState('')
  const [categoryType, setCategoryType] = useState<TransactionType>('expense')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<LocalizedMessage | null>(null)
  const [feedbackError, setFeedbackError] = useState(false)

  async function mutate(
    key: string,
    operation: () => Promise<unknown>,
    successKey: MessageKey,
  ) {
    if (!enabled || busy) return false
    setBusy(key)
    setFeedback(null)
    setFeedbackError(false)
    try {
      await operation()
      const refreshed = await onRefresh()
      setFeedback(message(refreshed ? successKey : 'savedRefreshFailed'))
      return true
    } catch (error) {
      setFeedback(messageForError(error, 'referenceSaveFailed'))
      setFeedbackError(true)
      return false
    } finally {
      setBusy(null)
    }
  }

  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const saved = await mutate(
      'account-new',
      () => actionData(createAccountAction({ name: accountName, type: accountType })),
      'referenceCreated',
    )
    if (saved) setAccountName('')
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const saved = await mutate(
      'category-new',
      () => actionData(createCategoryAction({ name: categoryName, type: categoryType })),
      'referenceCreated',
    )
    if (saved) setCategoryName('')
  }

  async function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    const trimmed = editor.name.trim()
    const name = trimmed === editor.originalDisplayName ? editor.rawName : trimmed
    const saved = editor.kind === 'account'
      ? await mutate(
          `account-${editor.id}`,
          () => actionData(updateAccountAction(editor.id, {
            name,
            type: editor.type,
            updatedAt: editor.updatedAt,
          })),
          'referenceUpdated',
        )
      : await mutate(
          `category-${editor.id}`,
          () => actionData(updateCategoryAction(editor.id, { name, updatedAt: editor.updatedAt })),
          'referenceUpdated',
        )
    if (saved) setEditor(null)
  }

  function editAccount(account: Account) {
    const displayName = localizeEntityName(account.name, account.localizationKey)
    setEditor({
      kind: 'account',
      id: account.id,
      name: displayName,
      originalDisplayName: displayName,
      rawName: account.name,
      type: account.type,
      originalType: account.type,
      updatedAt: account.updatedAt,
    })
  }

  function editCategory(category: Category) {
    const displayName = localizeEntityName(category.name, category.localizationKey)
    setEditor({
      kind: 'category',
      id: category.id,
      name: displayName,
      originalDisplayName: displayName,
      rawName: category.name,
      updatedAt: category.updatedAt,
    })
  }

  return (
    <div className="settings-panel reference-settings-panel">
      <div className="settings-panel-heading reference-settings-heading">
        <span className="settings-panel-icon" aria-hidden="true"><WalletCards /></span>
        <div>
          <h3>{t('referenceDataTitle')}</h3>
          <p>{t('referenceDataHelp')}</p>
        </div>
      </div>

      {!enabled ? <p className="reference-unavailable">{t('referenceUnavailable')}</p> : null}

      <div className="reference-settings-grid">
        <section className="reference-group" aria-labelledby="accounts-settings-title">
          <div className="reference-group-heading">
            <WalletCards aria-hidden="true" />
            <div>
              <h4 id="accounts-settings-title">{t('manageAccounts')}</h4>
              <p>{t('manageAccountsHelp')}</p>
            </div>
          </div>

          <form className="reference-create-form" onSubmit={addAccount}>
            <label>
              <span>{t('accountName')}</span>
              <input
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                maxLength={80}
                required
                disabled={!enabled || busy !== null}
              />
            </label>
            <label>
              <span>{t('accountType')}</span>
              <select
                value={accountType}
                onChange={(event) => setAccountType(event.target.value as AccountType)}
                disabled={!enabled || busy !== null}
              >
                {accountTypes.map((type) => (
                  <option value={type} key={type}>{accountTypeLabel(t, type)}</option>
                ))}
              </select>
            </label>
            <button className="button button-secondary" type="submit" disabled={!enabled || busy !== null}>
              <Plus aria-hidden="true" />
              {busy === 'account-new' ? t('saving') : t('addAccount')}
            </button>
          </form>

          <ul className="reference-list" aria-label={t('manageAccounts')}>
            {accounts.map((account) => (
              <li key={account.id}>
                <ReferenceRow
                  name={localizeEntityName(account.name, account.localizationKey)}
                  detail={accountTypeLabel(t, account.type)}
                  active={account.isActive}
                  editing={editor?.kind === 'account' && editor.id === account.id}
                  disabled={
                    !enabled
                    || busy !== null
                    || (editor?.kind === 'account' && editor.id === account.id)
                  }
                  onEdit={() => editAccount(account)}
                  onStatus={() => void mutate(
                    `account-status-${account.id}`,
                    () => actionData(setAccountStatusAction(account.id, {
                      isActive: !account.isActive,
                      updatedAt: account.updatedAt,
                    })),
                    account.isActive ? 'referenceDisabled' : 'referenceEnabled',
                  )}
                />
                {editor?.kind === 'account' && editor.id === account.id ? (
                  <EditorForm
                    editor={editor}
                    busy={busy !== null}
                    onChange={setEditor}
                    onCancel={() => setEditor(null)}
                    onSubmit={saveEditor}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="reference-group" aria-labelledby="categories-settings-title">
          <div className="reference-group-heading">
            <Tags aria-hidden="true" />
            <div>
              <h4 id="categories-settings-title">{t('manageCategories')}</h4>
              <p>{t('manageCategoriesHelp')}</p>
            </div>
          </div>

          <form className="reference-create-form" onSubmit={addCategory}>
            <label>
              <span>{t('categoryName')}</span>
              <input
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                maxLength={80}
                required
                disabled={!enabled || busy !== null}
              />
            </label>
            <label>
              <span>{t('categoryType')}</span>
              <select
                value={categoryType}
                onChange={(event) => setCategoryType(event.target.value as TransactionType)}
                disabled={!enabled || busy !== null}
              >
                <option value="expense">{t('expense')}</option>
                <option value="income">{t('income')}</option>
              </select>
            </label>
            <button className="button button-secondary" type="submit" disabled={!enabled || busy !== null}>
              <Plus aria-hidden="true" />
              {busy === 'category-new' ? t('saving') : t('addCategory')}
            </button>
          </form>

          <ul className="reference-list" aria-label={t('manageCategories')}>
            {categories.map((category) => (
              <li key={category.id}>
                <ReferenceRow
                  name={localizeEntityName(category.name, category.localizationKey)}
                  detail={t(category.type)}
                  active={category.isActive}
                  editing={editor?.kind === 'category' && editor.id === category.id}
                  disabled={
                    !enabled
                    || busy !== null
                    || (editor?.kind === 'category' && editor.id === category.id)
                  }
                  onEdit={() => editCategory(category)}
                  onStatus={() => void mutate(
                    `category-status-${category.id}`,
                    () => actionData(setCategoryStatusAction(category.id, {
                      isActive: !category.isActive,
                      updatedAt: category.updatedAt,
                    })),
                    category.isActive ? 'referenceDisabled' : 'referenceEnabled',
                  )}
                />
                {editor?.kind === 'category' && editor.id === category.id ? (
                  <EditorForm
                    editor={editor}
                    busy={busy !== null}
                    onChange={setEditor}
                    onCancel={() => setEditor(null)}
                    onSubmit={saveEditor}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="reference-history-help">{t('referenceHistoryHelp')}</p>
      <p
        className={`reference-feedback ${feedbackError ? 'is-error' : ''}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {renderMessage(t, feedback)}
      </p>
    </div>
  )
}

type ReferenceRowProps = {
  name: string
  detail: string
  active: boolean
  editing: boolean
  disabled: boolean
  onEdit: () => void
  onStatus: () => void
}

function ReferenceRow({ name, detail, active, editing, disabled, onEdit, onStatus }: ReferenceRowProps) {
  const { t } = useI18n()
  return (
    <div className="reference-row">
      <div className="reference-row-copy">
        <strong>{name}</strong>
        <span>{detail} · {active ? t('active') : t('inactive')}</span>
      </div>
      <div className="reference-row-actions">
        <button className="button button-secondary" type="button" onClick={onEdit} disabled={disabled || editing}>
          <Pencil aria-hidden="true" />
          {t('edit')}
        </button>
        <button className="button button-secondary" type="button" onClick={onStatus} disabled={disabled}>
          {active ? null : <RotateCcw aria-hidden="true" />}
          {active ? t('disableReference') : t('enableReference')}
        </button>
      </div>
    </div>
  )
}

type EditorFormProps = {
  editor: Editor
  busy: boolean
  onChange: (editor: Editor) => void
  onCancel: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

function EditorForm({ editor, busy, onChange, onCancel, onSubmit }: EditorFormProps) {
  const { t } = useI18n()
  const unchanged = editor.name.trim() === editor.originalDisplayName
    && (editor.kind === 'category' || editor.type === editor.originalType)
  return (
    <form className="reference-editor" onSubmit={onSubmit}>
      <label>
        <span>{editor.kind === 'account' ? t('accountName') : t('categoryName')}</span>
        <input
          value={editor.name}
          onChange={(event) => onChange({ ...editor, name: event.target.value })}
          maxLength={80}
          required
          autoFocus
          disabled={busy}
        />
      </label>
      {editor.kind === 'account' ? (
        <label>
          <span>{t('accountType')}</span>
          <select
            value={editor.type}
            onChange={(event) => onChange({ ...editor, type: event.target.value as AccountType })}
            disabled={busy}
          >
            {accountTypes.map((type) => (
              <option value={type} key={type}>{accountTypeLabel(t, type)}</option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="reference-editor-actions">
        <button className="button button-primary" type="submit" disabled={busy || unchanged}>
          {t('saveChanges')}
        </button>
        <button className="button button-secondary" type="button" onClick={onCancel} disabled={busy}>
          {t('cancel')}
        </button>
      </div>
    </form>
  )
}

const accountTypes: AccountType[] = ['cash', 'bank', 'credit_card', 'wallet']

function accountTypeLabel(t: (key: MessageKey) => string, type: AccountType) {
  if (type === 'cash') return t('accountCash')
  if (type === 'bank') return t('accountBank')
  if (type === 'credit_card') return t('accountCreditCard')
  return t('accountWallet')
}
