import { ArrowDown, ArrowUp, Pencil, Plus, RotateCcw, Tags, WalletCards } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import {
  createAccountAction,
  createCategoryAction,
  reorderAccountsAction,
  reorderCategoriesAction,
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
import {
  formatAmountInput,
  formatSignedAmountInput,
  parseAmount,
  parseSignedAmount,
} from '../lib/money'
import type { SupportedCurrency } from '../lib/currency'
import {
  canMoveReference,
  orderedReferenceGroup,
  type ReferenceMoveDirection,
} from '../lib/referenceOrder'

type ReferenceDataSettingsProps = {
  accounts: Account[]
  categories: Category[]
  expectedCurrency: SupportedCurrency
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
      openingBalance: string
      originalOpeningBalance: string
      openingBalanceOn: string
      originalOpeningBalanceOn: string
      updatedAt: string
    }
  | {
      kind: 'category'
      id: number
      name: string
      originalDisplayName: string
      rawName: string
      type: TransactionType
      monthlyPlan: string
      originalMonthlyPlan: string
      updatedAt: string
    }

export function ReferenceDataSettings({
  accounts,
  categories,
  expectedCurrency,
  enabled,
  onRefresh,
}: ReferenceDataSettingsProps) {
  const { formatMoney, locale, localizeEntityName, privacyMode, t } = useI18n()
  const [accountName, setAccountName] = useState('')
  const [accountType, setAccountType] = useState<AccountType>('bank')
  const [accountOpeningBalance, setAccountOpeningBalance] = useState('')
  const [accountOpeningBalanceOn, setAccountOpeningBalanceOn] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [categoryType, setCategoryType] = useState<TransactionType>('expense')
  const [categoryMonthlyPlan, setCategoryMonthlyPlan] = useState('')
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
    const opening = parseOptionalOpeningBalance(
      accountOpeningBalance,
      accountOpeningBalanceOn,
      locale,
    )
    if (!opening) {
      setFeedback(message('invalidOpeningBalance'))
      setFeedbackError(true)
      return
    }
    const saved = await mutate(
      'account-new',
      () => actionData(createAccountAction({
        name: accountName,
        type: accountType,
        expectedCurrency,
        ...opening,
      })),
      'referenceCreated',
    )
    if (saved) {
      setAccountName('')
      setAccountOpeningBalance('')
      setAccountOpeningBalanceOn('')
    }
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const monthlyPlanMinor = categoryType === 'expense'
      ? parseOptionalMonthlyPlan(categoryMonthlyPlan, locale)
      : null
    if (monthlyPlanMinor === undefined) {
      setFeedback(message('invalidMonthlyPlan'))
      setFeedbackError(true)
      return
    }
    const saved = await mutate(
      'category-new',
      () => actionData(createCategoryAction({
        name: categoryName,
        type: categoryType,
        expectedCurrency,
        monthlyPlanMinor,
      })),
      'referenceCreated',
    )
    if (saved) {
      setCategoryName('')
      setCategoryMonthlyPlan('')
    }
  }

  async function moveAccount(account: Account, direction: ReferenceMoveDirection) {
    if (!canMoveReference(accounts, account, direction, accountOrderGroup)) return
    const items = orderedReferenceGroup(accounts, account, direction, accountOrderGroup)
      .map(({ id, updatedAt }) => ({ id, updatedAt }))
    await mutate(
      `account-order-${account.id}`,
      () => actionData(reorderAccountsAction({ items })),
      'referenceReordered',
    )
  }

  async function moveCategory(category: Category, direction: ReferenceMoveDirection) {
    if (!canMoveReference(categories, category, direction, categoryOrderGroup)) return
    const items = orderedReferenceGroup(categories, category, direction, categoryOrderGroup)
      .map(({ id, updatedAt }) => ({ id, updatedAt }))
    await mutate(
      `category-order-${category.id}`,
      () => actionData(reorderCategoriesAction({ items })),
      'referenceReordered',
    )
  }

  async function saveEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) return
    const trimmed = editor.name.trim()
    const name = trimmed === editor.originalDisplayName ? editor.rawName : trimmed
    const monthlyPlanMinor = editor.kind === 'category'
      ? parseOptionalMonthlyPlan(editor.monthlyPlan, locale)
      : null
    if (monthlyPlanMinor === undefined) {
      setFeedback(message('invalidMonthlyPlan'))
      setFeedbackError(true)
      return
    }
    const opening = editor.kind === 'account'
      ? parseOptionalOpeningBalance(editor.openingBalance, editor.openingBalanceOn, locale)
      : null
    if (editor.kind === 'account' && !opening) {
      setFeedback(message('invalidOpeningBalance'))
      setFeedbackError(true)
      return
    }
    const saved = editor.kind === 'account'
      ? await mutate(
          `account-${editor.id}`,
          () => actionData(updateAccountAction(editor.id, {
            name,
            type: editor.type,
            expectedCurrency,
            ...(opening ?? { openingBalanceMinor: null, openingBalanceOn: null }),
            updatedAt: editor.updatedAt,
          })),
          'referenceUpdated',
        )
      : await mutate(
          `category-${editor.id}`,
          () => actionData(updateCategoryAction(editor.id, {
            name,
            type: editor.type,
            expectedCurrency,
            monthlyPlanMinor,
            updatedAt: editor.updatedAt,
          })),
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
      openingBalance: account.openingBalanceMinor === null
        ? ''
        : formatSignedAmountInput(account.openingBalanceMinor, locale),
      originalOpeningBalance: account.openingBalanceMinor === null
        ? ''
        : formatSignedAmountInput(account.openingBalanceMinor, locale),
      openingBalanceOn: account.openingBalanceOn ?? '',
      originalOpeningBalanceOn: account.openingBalanceOn ?? '',
      updatedAt: account.updatedAt,
    })
  }

  function editCategory(category: Category) {
    const displayName = localizeEntityName(category.name, category.localizationKey)
    const monthlyPlan = category.monthlyPlanMinor === null
      ? ''
      : formatAmountInput(category.monthlyPlanMinor, locale)
    setEditor({
      kind: 'category',
      id: category.id,
      name: displayName,
      originalDisplayName: displayName,
      rawName: category.name,
      type: category.type,
      monthlyPlan,
      originalMonthlyPlan: monthlyPlan,
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
            <label>
              <span>{t('openingBalanceOptional')}</span>
              <input
                type={privacyMode ? 'password' : 'text'}
                inputMode="decimal"
                autoComplete="off"
                maxLength={80}
                value={accountOpeningBalance}
                onChange={(event) => setAccountOpeningBalance(event.target.value)}
                placeholder={t('openingBalancePlaceholder')}
                disabled={!enabled || busy !== null}
              />
            </label>
            <label>
              <span>{t('openingBalanceOnOptional')}</span>
              <input
                type="date"
                value={accountOpeningBalanceOn}
                onChange={(event) => setAccountOpeningBalanceOn(event.target.value)}
                disabled={!enabled || busy !== null}
              />
              <small>{t('openingBalanceHelp')}</small>
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
                  detail={`${accountTypeLabel(t, account.type)} · ${account.openingBalanceMinor === null
                    ? t('balanceFromRecordedHistory')
                    : t('openingBalanceValue', {
                        amount: formatMoney(account.openingBalanceMinor),
                        date: account.openingBalanceOn ?? '',
                      })}`}
                  active={account.isActive}
                  editing={editor?.kind === 'account' && editor.id === account.id}
                  disabled={
                    !enabled
                    || busy !== null
                    || (editor?.kind === 'account' && editor.id === account.id)
                  }
                  canMoveUp={editor === null && canMoveReference(accounts, account, 'up', accountOrderGroup)}
                  canMoveDown={editor === null && canMoveReference(accounts, account, 'down', accountOrderGroup)}
                  onMoveUp={() => void moveAccount(account, 'up')}
                  onMoveDown={() => void moveAccount(account, 'down')}
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
                onChange={(event) => {
                  const nextType = event.target.value as TransactionType
                  setCategoryType(nextType)
                  if (nextType === 'income') setCategoryMonthlyPlan('')
                }}
                disabled={!enabled || busy !== null}
              >
                <option value="expense">{t('expense')}</option>
                <option value="income">{t('income')}</option>
              </select>
            </label>
            {categoryType === 'expense' ? (
              <label>
                <span>{t('monthlySpendingPlanOptional')}</span>
                <input
                  type={privacyMode ? 'password' : 'text'}
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={80}
                  value={categoryMonthlyPlan}
                  onChange={(event) => setCategoryMonthlyPlan(event.target.value)}
                  placeholder={t('monthlySpendingPlanPlaceholder')}
                  disabled={!enabled || busy !== null}
                />
                <small>{t('monthlySpendingPlanFieldHelp')}</small>
              </label>
            ) : null}
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
                  detail={category.monthlyPlanMinor === null
                    ? `${t(category.type)} · ${t('noMonthlySpendingPlan')}`
                    : `${t(category.type)} · ${t('monthlySpendingPlanValue', {
                        amount: formatMoney(category.monthlyPlanMinor),
                      })}`}
                  active={category.isActive}
                  editing={editor?.kind === 'category' && editor.id === category.id}
                  disabled={
                    !enabled
                    || busy !== null
                    || (editor?.kind === 'category' && editor.id === category.id)
                  }
                  canMoveUp={editor === null && canMoveReference(categories, category, 'up', categoryOrderGroup)}
                  canMoveDown={editor === null && canMoveReference(categories, category, 'down', categoryOrderGroup)}
                  onMoveUp={() => void moveCategory(category, 'up')}
                  onMoveDown={() => void moveCategory(category, 'down')}
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
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onStatus: () => void
}

function ReferenceRow({
  name,
  detail,
  active,
  editing,
  disabled,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onEdit,
  onStatus,
}: ReferenceRowProps) {
  const { t } = useI18n()
  return (
    <div className="reference-row">
      <div className="reference-row-copy">
        <strong>{name}</strong>
        <span>{detail} · {active ? t('active') : t('inactive')}</span>
      </div>
      <div className="reference-row-actions">
        <button
          className="button button-secondary reference-order-button"
          type="button"
          onClick={onMoveUp}
          disabled={disabled || !canMoveUp}
          aria-label={t('moveReferenceUp', { name })}
          title={t('moveReferenceUp', { name })}
        >
          <ArrowUp aria-hidden="true" />
        </button>
        <button
          className="button button-secondary reference-order-button"
          type="button"
          onClick={onMoveDown}
          disabled={disabled || !canMoveDown}
          aria-label={t('moveReferenceDown', { name })}
          title={t('moveReferenceDown', { name })}
        >
          <ArrowDown aria-hidden="true" />
        </button>
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
  const { privacyMode, t } = useI18n()
  const unchanged = editor.name.trim() === editor.originalDisplayName
    && (editor.kind === 'category'
      ? editor.monthlyPlan.trim() === editor.originalMonthlyPlan
      : editor.type === editor.originalType
        && editor.openingBalance.trim() === editor.originalOpeningBalance
        && editor.openingBalanceOn === editor.originalOpeningBalanceOn)
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
        <>
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
          <label>
            <span>{t('openingBalanceOptional')}</span>
            <input
              type={privacyMode ? 'password' : 'text'}
              inputMode="decimal"
              autoComplete="off"
              maxLength={80}
              value={editor.openingBalance}
              onChange={(event) => onChange({ ...editor, openingBalance: event.target.value })}
              placeholder={t('openingBalancePlaceholder')}
              disabled={busy}
            />
          </label>
          <label>
            <span>{t('openingBalanceOnOptional')}</span>
            <input
              type="date"
              value={editor.openingBalanceOn}
              onChange={(event) => onChange({ ...editor, openingBalanceOn: event.target.value })}
              disabled={busy}
            />
            <small>{t('openingBalanceHelp')}</small>
          </label>
        </>
      ) : editor.type === 'expense' ? (
        <label>
          <span>{t('monthlySpendingPlanOptional')}</span>
          <input
            type={privacyMode ? 'password' : 'text'}
            inputMode="decimal"
            autoComplete="off"
            maxLength={80}
            value={editor.monthlyPlan}
            onChange={(event) => onChange({ ...editor, monthlyPlan: event.target.value })}
            placeholder={t('monthlySpendingPlanPlaceholder')}
            disabled={busy}
          />
          <small>{t('monthlySpendingPlanFieldHelp')}</small>
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

const accountOrderGroup = (account: Account) => String(account.isActive)
const categoryOrderGroup = (category: Category) => `${category.type}:${category.isActive}`

function accountTypeLabel(t: (key: MessageKey) => string, type: AccountType) {
  if (type === 'cash') return t('accountCash')
  if (type === 'bank') return t('accountBank')
  if (type === 'credit_card') return t('accountCreditCard')
  return t('accountWallet')
}

function parseOptionalMonthlyPlan(value: string, locale: string) {
  if (!value.trim()) return null
  try {
    return parseAmount(value, locale)
  } catch {
    return undefined
  }
}

function parseOptionalOpeningBalance(balance: string, on: string, locale: string) {
  const trimmedBalance = balance.trim()
  const trimmedOn = on.trim()
  if (!trimmedBalance && !trimmedOn) {
    return { openingBalanceMinor: null, openingBalanceOn: null }
  }
  if (!trimmedBalance || !trimmedOn) return undefined
  try {
    return {
      openingBalanceMinor: parseSignedAmount(trimmedBalance, locale),
      openingBalanceOn: trimmedOn,
    }
  } catch {
    return undefined
  }
}
