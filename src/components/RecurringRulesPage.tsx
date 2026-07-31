import {
  CalendarCheck,
  CalendarClock,
  CalendarX2,
  CircleAlert,
  CloudOff,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRecurringRules } from '../hooks/useRecurringRules'
import { useHongKongToday } from '../hooks/useHongKongToday'
import type { DataSource, RefreshFailureMode } from '../hooks/useMoneyData'
import { useI18n } from '../i18n'
import {
  countDueRecurringRules,
  orderRecurringRulesByUrgency,
  recurringRuleUrgency,
  type RecurringRuleUrgency,
} from '../lib/recurringUrgency'
import { getRecurringAmountReview } from '../lib/recurringAmountReview'
import { resolveRecurringRuleRequest } from '../lib/recurringRuleRequest'
import { resolveRecurringSurface, type RecurringSurface } from '../lib/recurringSurface'
import type {
  Account,
  Category,
  RecurringRule,
  RecurringRuleCreateInput,
  RecurringRuleUpdateInput,
} from '../lib/schema'
import { RecurringDeleteDialog } from './RecurringDeleteDialog'
import { RecurringAmountReview } from './RecurringAmountReview'
import { RecurringRuleDialog } from './RecurringRuleDialog'
import { RecurringTransferRulesPanel } from './RecurringTransferRulesPanel'

type RecurringRulesPageProps = {
  active: boolean
  accounts: Account[]
  categories: Category[]
  draft: RecurringRuleCreateInput | null
  focusRuleId: string | null
  focusTransferRuleId: string | null
  ledgerContext: string
  ledgerSource: DataSource
  mutable: boolean
  onMoneyRefresh: (failureMode?: RefreshFailureMode) => Promise<boolean>
  onDraftClose: () => void
  onFocusRuleHandled: () => void
  onFocusTransferRuleHandled: () => void
  onMutationStateChange: (mutating: boolean) => void
}

export function RecurringRulesPage({
  active,
  accounts,
  categories,
  draft,
  focusRuleId,
  focusTransferRuleId,
  ledgerContext,
  ledgerSource,
  mutable,
  onMoneyRefresh,
  onDraftClose,
  onFocusRuleHandled,
  onFocusTransferRuleHandled,
  onMutationStateChange,
}: RecurringRulesPageProps) {
  const { formatDate, formatMoney, localizeEntityName, t } = useI18n()
  const recurring = useRecurringRules(onMoneyRefresh, mutable, ledgerSource, active)
  const clearRecurringActionMessage = recurring.clearActionMessage
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null)
  const [deletingRule, setDeletingRule] = useState<RecurringRule | null>(null)
  const [transferMutationInProgress, setTransferMutationInProgress] = useState(false)
  const [surface, setSurface] = useState<RecurringSurface>('transactions')
  const ledgerLive = ledgerSource === 'live'
  const mutationsEnabled = ledgerLive
    && mutable
    && recurring.online
    && recurring.source === 'live'
    && !transferMutationInProgress
  const transactionMutationInProgress = recurring.running || recurring.mutatingId !== null
  const mutationInProgress = transactionMutationInProgress || transferMutationInProgress

  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories])
  const frequencyLabels = {
    daily: t('daily'),
    weekly: t('weekly'),
    monthly: t('monthly'),
    yearly: t('yearly'),
  }
  const today = useHongKongToday()
  const orderedRules = useMemo(
    () => orderRecurringRulesByUrgency(recurring.rules, today),
    [recurring.rules, today],
  )
  const dueRuleCount = useMemo(
    () => countDueRecurringRules(recurring.rules, today),
    [recurring.rules, today],
  )
  const urgencyLabel = (urgency: RecurringRuleUrgency) => {
    if (urgency === 'overdue') return t('recurringOverdue')
    if (urgency === 'due_today') return t('recurringDueToday')
    if (urgency === 'due_soon') return t('recurringDueSoon')
    if (urgency === 'completed') return t('recurringCompleted')
    if (urgency === 'paused') return t('paused')
    return t('active')
  }

  const closeEditor = useCallback(() => {
    setEditorOpen(false)
    setEditingRule(null)
    onDraftClose()
  }, [onDraftClose])
  const closeDelete = useCallback(() => setDeletingRule(null), [])
  const visibleSurface = resolveRecurringSurface(
    surface,
    Boolean(focusRuleId || draft),
    Boolean(focusTransferRuleId),
  )
  const handleFocusRuleHandled = useCallback(() => {
    setSurface('transactions')
    onFocusRuleHandled()
  }, [onFocusRuleHandled])
  const handleTransferFocusRuleHandled = useCallback(() => {
    setSurface('transfers')
    onFocusTransferRuleHandled()
  }, [onFocusTransferRuleHandled])

  useEffect(() => {
    if (ledgerLive) return
    const timeout = window.setTimeout(() => {
      closeEditor()
      closeDelete()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [closeDelete, closeEditor, ledgerLive])

  useEffect(() => {
    if (mutationsEnabled) return
    const timeout = window.setTimeout(() => setDeletingRule(null), 0)
    return () => window.clearTimeout(timeout)
  }, [mutationsEnabled])

  useEffect(() => {
    onMutationStateChange(mutationInProgress)
  }, [mutationInProgress, onMutationStateChange])

  useEffect(() => () => onMutationStateChange(false), [onMutationStateChange])

  const openCreate = () => {
    recurring.clearActionMessage()
    onDraftClose()
    setEditingRule(null)
    setEditorOpen(true)
  }

  const openEdit = useCallback((rule: RecurringRule) => {
    clearRecurringActionMessage()
    onDraftClose()
    setEditingRule(rule)
    setEditorOpen(true)
  }, [clearRecurringActionMessage, onDraftClose])

  useEffect(() => {
    const focusedRule = resolveRecurringRuleRequest(
      focusRuleId,
      recurring.rules,
      recurring.source !== 'loading',
      !draft && !editorOpen && !deletingRule,
      mutationsEnabled,
    )
    if (focusedRule === undefined) return
    const timeout = window.setTimeout(() => {
      handleFocusRuleHandled()
      if (focusedRule !== null) openEdit(focusedRule)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [
    deletingRule,
    draft,
    editorOpen,
    focusRuleId,
    mutationsEnabled,
    handleFocusRuleHandled,
    openEdit,
    recurring.rules,
    recurring.source,
  ])

  const createRule = useCallback(
    (input: RecurringRuleCreateInput) => recurring.createRule(input),
    [recurring],
  )
  const editRule = useCallback(
    (id: string, input: RecurringRuleUpdateInput) => recurring.editRule(id, input),
    [recurring],
  )

  const statusContent = (() => {
    if (!recurring.online) {
      return {
        className: 'recurring-status status-warning',
        icon: <CloudOff aria-hidden="true" />,
        text: t('recurringOfflineStatus'),
      }
    }
    if (ledgerSource === 'loading' || (ledgerLive && recurring.source === 'loading')) {
      return {
        className: 'recurring-status',
        icon: <LoaderCircle className="spin" aria-hidden="true" />,
        text: t('recurringLoadingStatus'),
      }
    }
    if (!ledgerLive) {
      return {
        className: 'recurring-status status-warning',
        icon: <Sparkles aria-hidden="true" />,
        text: t('recurringDemoStatus'),
      }
    }
    if (recurring.source === 'error' || recurring.error) {
      return {
        className: 'recurring-status status-error',
        icon: <CircleAlert aria-hidden="true" />,
        text: recurring.error || t('recurringLoadFailed'),
      }
    }
    if (recurring.actionMessage) {
      return {
        className: `recurring-status ${recurring.actionWarning ? 'status-warning' : 'status-success'}`,
        icon: recurring.actionWarning
          ? <CircleAlert aria-hidden="true" />
          : <CalendarCheck aria-hidden="true" />,
        text: recurring.actionMessage,
      }
    }
    if (recurring.source === 'demo') {
      return {
        className: 'recurring-status status-warning',
        icon: <Sparkles aria-hidden="true" />,
        text: t('recurringDemoStatus'),
      }
    }
    return null
  })()

  const loading = ledgerSource === 'loading'
    || (ledgerLive && recurring.source === 'loading')

  return (
    <section className="recurring-page" aria-labelledby="recurring-page-title">
      <div className="recurring-hero">
        <div className="recurring-hero-copy">
          <h2 id="recurring-page-title">{t('recurring')}</h2>
          <p>{t('recurringPageDescription')}</p>
        </div>
        {visibleSurface === 'transactions' ? <div className="recurring-hero-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void recurring.runDue()}
            disabled={!mutationsEnabled || recurring.running || loading}
          >
            {recurring.running ? <LoaderCircle className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {recurring.running ? t('checking') : t('generateDueTransactions')}
          </button>
          <button className="button button-primary" type="button" onClick={openCreate} disabled={!mutationsEnabled}>
            <Plus aria-hidden="true" />
            {t('addRecurringRule')}
          </button>
        </div> : null}
      </div>

      {visibleSurface === 'transactions' && statusContent ? (
        <div className={statusContent.className} role={recurring.error ? 'alert' : 'status'}>
          {statusContent.icon}
          <span>{statusContent.text}</span>
          {recurring.source === 'error' ? (
            <button type="button" onClick={() => void recurring.refresh()}>
              <RefreshCw aria-hidden="true" />
              {t('retry')}
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className="recurring-surface-switch"
        role="group"
        aria-label={t('recurring')}
      >
        <button
          type="button"
          aria-pressed={visibleSurface === 'transactions'}
          className={visibleSurface === 'transactions' ? 'is-active' : undefined}
          onClick={() => setSurface('transactions')}
        >
          <Repeat aria-hidden="true" />
          {t('recurring')}
        </button>
        <button
          type="button"
          aria-pressed={visibleSurface === 'transfers'}
          className={visibleSurface === 'transfers' ? 'is-active' : undefined}
          onClick={() => setSurface('transfers')}
        >
          <RefreshCw aria-hidden="true" />
          {t('scheduledTransfers')}
        </button>
      </div>

      {visibleSurface === 'transactions' ? <div className="recurring-panel">
        <div className="recurring-panel-heading">
          <div>
            <h3>{t('automationSettings')}</h3>
            <p>{loading ? t('loading') : t('recurringRuleCount', { count: recurring.rules.length })}</p>
            {!loading && dueRuleCount > 0 ? (
              <p className="recurring-due-summary">
                <CircleAlert aria-hidden="true" />
                {t('recurringDueCount', { count: dueRuleCount })}
              </p>
            ) : null}
          </div>
          <span className="date-only-note">
            <CalendarClock aria-hidden="true" />
            {t('dateOnlyNote')}
          </span>
        </div>

        {loading ? (
          <div className="recurring-empty" role="status">
            <LoaderCircle className="spin" aria-hidden="true" />
            {t('organizingRecurring')}
          </div>
        ) : recurring.rules.length === 0 ? (
          <div className="recurring-empty">
            <span className="recurring-empty-icon" aria-hidden="true">
              <Repeat />
            </span>
            <strong>{t('noRecurringRules')}</strong>
            <span>{t('noRecurringRulesHelp')}</span>
          </div>
        ) : (
          <ul className="recurring-list" aria-label={t('recurringRuleList')}>
            {orderedRules.map((rule) => {
              const busy = recurring.mutatingId === rule.id
              const urgency = recurringRuleUrgency(rule, today)
              const completed = urgency === 'completed'
              const amountReview = completed || !recurring.reviewDataFresh
                ? null
                : getRecurringAmountReview(rule)
              const account = accountsById.get(rule.accountId)
              const category = categoriesById.get(rule.categoryId)
              const accountName = account
                ? localizeEntityName(account.name, account.localizationKey)
                : t('unknownAccount')
              const categoryName = category
                ? localizeEntityName(category.name, category.localizationKey)
                : t('unknownCategory')
              return (
                <li
                  className={`recurring-rule is-${urgency.replace('_', '-')}`}
                  key={rule.id}
                >
                  <div className="recurring-rule-main">
                    <span className={`recurring-rule-icon ${rule.type}`} aria-hidden="true">
                      <Repeat />
                    </span>
                    <div className="recurring-rule-title">
                      <span className={`rule-status is-${urgency.replace('_', '-')}`}>
                        {urgencyLabel(urgency)}
                      </span>
                      <strong>{rule.name}</strong>
                      <small>{rule.payee || `${categoryName} · ${accountName}`}</small>
                    </div>
                  </div>

                  <div className="recurring-rule-amount">
                    <span>{t('eachTime')}</span>
                    <strong className={rule.type}>
                      <span className="sr-only">{rule.type === 'income' ? t('income') : t('expense')}</span>
                      {rule.type === 'income' ? '+' : '−'}
                      {formatMoney(rule.amountMinor, rule.currency)}
                    </strong>
                  </div>

                  <dl className="recurring-rule-details">
                    <div>
                      <dt>{t('frequency')}</dt>
                      <dd>{frequencyLabels[rule.frequency]}</dd>
                    </div>
                    <div>
                      <dt>{t('nextDate')}</dt>
                      <dd>{completed ? '—' : formatDate(rule.nextOccurrenceOn)}</dd>
                    </div>
                    <div>
                      <dt>{t('scheduleEndDate')}</dt>
                      <dd>
                        {rule.scheduleEndsOn
                          ? formatDate(rule.scheduleEndsOn)
                          : t('noScheduleEndDate')}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('accountAndCategory')}</dt>
                      <dd>
                        {accountName} · {categoryName}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('generated')}</dt>
                      <dd>{t('generatedCount', { count: rule.generatedCount })}</dd>
                    </div>
                  </dl>

                  {amountReview ? (
                    <RecurringAmountReview currency={rule.currency} review={amountReview} />
                  ) : null}

                  {rule.lastErrorCode ? (
                    <p className="rule-error" role="status">
                      <CircleAlert aria-hidden="true" />
                      {t('recurringGenerationFailed')}
                    </p>
                  ) : null}

                  <div className="recurring-rule-actions">
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => openEdit(rule)}
                      disabled={!mutationsEnabled || busy}
                    >
                      <Pencil aria-hidden="true" />
                      {t('edit')}
                    </button>
                    {!completed && rule.isActive ? (
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() => {
                          const date = formatDate(rule.nextOccurrenceOn)
                          if (window.confirm(t('skipRecurringConfirm', { name: rule.name, date }))) {
                            void recurring.skipRuleOccurrence(rule)
                          }
                        }}
                        disabled={!mutationsEnabled || busy}
                      >
                        <CalendarX2 aria-hidden="true" />
                        {t('skipNextOccurrence')}
                      </button>
                    ) : null}
                    {!completed ? (
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() => void recurring.setRuleActive(rule, !rule.isActive)}
                        disabled={!mutationsEnabled || busy}
                      >
                        {busy ? (
                          <LoaderCircle className="spin" aria-hidden="true" />
                        ) : rule.isActive ? (
                          <Pause aria-hidden="true" />
                        ) : (
                          <Play aria-hidden="true" />
                        )}
                        {rule.isActive ? t('pause') : t('resume')}
                      </button>
                    ) : null}
                    <button
                      className="button recurring-delete-button"
                      type="button"
                      onClick={() => setDeletingRule(rule)}
                      disabled={!mutationsEnabled || busy}
                    >
                      <Trash2 aria-hidden="true" />
                      {t('delete')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div> : null}

      <div hidden={visibleSurface !== 'transfers'}>
        <RecurringTransferRulesPanel
          accounts={accounts}
          focusRuleId={focusTransferRuleId}
          ledgerContext={ledgerContext}
          ledgerSource={ledgerSource}
          mutable={mutable && !transactionMutationInProgress}
          onMoneyRefresh={onMoneyRefresh}
          onFocusRuleHandled={handleTransferFocusRuleHandled}
          onMutationStateChange={setTransferMutationInProgress}
          today={today}
        />
      </div>

      {ledgerLive && (editorOpen || draft) ? (
        <RecurringRuleDialog
          key={draft?.id ?? editingRule?.id ?? 'new'}
          rule={draft ? null : editingRule}
          draft={draft}
          accounts={accounts}
          categories={categories}
          ledgerContext={ledgerContext}
          saving={recurring.mutatingId === (editingRule?.id ?? 'new')}
          serverError={recurring.error}
          mutable={mutationsEnabled}
          onClose={closeEditor}
          onCreate={createRule}
          onEdit={editRule}
        />
      ) : null}

      {ledgerLive && deletingRule ? (
        <RecurringDeleteDialog
          rule={deletingRule}
          deleting={recurring.mutatingId === deletingRule.id}
          mutable={mutationsEnabled}
          onClose={closeDelete}
          onConfirm={() => recurring.deleteRule(deletingRule)}
        />
      ) : null}
    </section>
  )
}
