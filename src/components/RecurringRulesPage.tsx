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
import { useCallback, useMemo, useState } from 'react'
import { useRecurringRules } from '../hooks/useRecurringRules'
import { useI18n } from '../i18n'
import type {
  Account,
  Category,
  RecurringRule,
  RecurringRuleCreateInput,
  RecurringRuleUpdateInput,
} from '../lib/schema'
import { RecurringDeleteDialog } from './RecurringDeleteDialog'
import { RecurringRuleDialog } from './RecurringRuleDialog'

type RecurringRulesPageProps = {
  accounts: Account[]
  categories: Category[]
  draft: RecurringRuleCreateInput | null
  onMoneyRefresh: () => Promise<boolean>
  onDraftClose: () => void
}

export function RecurringRulesPage({
  accounts,
  categories,
  draft,
  onMoneyRefresh,
  onDraftClose,
}: RecurringRulesPageProps) {
  const { formatDate, formatMoney, localizeEntityName, t } = useI18n()
  const recurring = useRecurringRules(onMoneyRefresh)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null)
  const [deletingRule, setDeletingRule] = useState<RecurringRule | null>(null)

  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories])
  const frequencyLabels = {
    daily: t('daily'),
    weekly: t('weekly'),
    monthly: t('monthly'),
  }

  const closeEditor = useCallback(() => {
    setEditorOpen(false)
    setEditingRule(null)
    onDraftClose()
  }, [onDraftClose])
  const closeDelete = useCallback(() => setDeletingRule(null), [])

  const openCreate = () => {
    recurring.clearActionMessage()
    onDraftClose()
    setEditingRule(null)
    setEditorOpen(true)
  }

  const openEdit = (rule: RecurringRule) => {
    recurring.clearActionMessage()
    onDraftClose()
    setEditingRule(rule)
    setEditorOpen(true)
  }

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
    if (recurring.source === 'loading') {
      return {
        className: 'recurring-status',
        icon: <LoaderCircle className="spin" aria-hidden="true" />,
        text: t('recurringLoadingStatus'),
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
        className: 'recurring-status status-success',
        icon: <CalendarCheck aria-hidden="true" />,
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

  const loading = recurring.source === 'loading'

  return (
    <section className="recurring-page" aria-labelledby="recurring-page-title">
      <div className="recurring-hero">
        <div className="recurring-hero-copy">
          <h2 id="recurring-page-title">{t('recurring')}</h2>
          <p>{t('recurringPageDescription')}</p>
        </div>
        <div className="recurring-hero-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void recurring.runDue()}
            disabled={!recurring.online || recurring.running || loading}
          >
            {recurring.running ? <LoaderCircle className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {recurring.running ? t('checking') : t('generateDueTransactions')}
          </button>
          <button className="button button-primary" type="button" onClick={openCreate} disabled={!recurring.online}>
            <Plus aria-hidden="true" />
            {t('addRecurringRule')}
          </button>
        </div>
      </div>

      {statusContent ? (
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

      <div className="recurring-panel">
        <div className="recurring-panel-heading">
          <div>
            <h3>{t('automationSettings')}</h3>
            <p>{loading ? t('loading') : t('recurringRuleCount', { count: recurring.rules.length })}</p>
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
            <button className="button button-primary" type="button" onClick={openCreate} disabled={!recurring.online}>
              <Plus aria-hidden="true" />
              {t('createFirstRule')}
            </button>
          </div>
        ) : (
          <ul className="recurring-list" aria-label={t('recurringRuleList')}>
            {recurring.rules.map((rule) => {
              const busy = recurring.mutatingId === rule.id
              const account = accountsById.get(rule.accountId)
              const category = categoriesById.get(rule.categoryId)
              const accountName = account
                ? localizeEntityName(account.name, account.localizationKey)
                : t('unknownAccount')
              const categoryName = category
                ? localizeEntityName(category.name, category.localizationKey)
                : t('unknownCategory')
              return (
                <li className={`recurring-rule ${rule.isActive ? '' : 'is-paused'}`} key={rule.id}>
                  <div className="recurring-rule-main">
                    <span className={`recurring-rule-icon ${rule.type}`} aria-hidden="true">
                      <Repeat />
                    </span>
                    <div className="recurring-rule-title">
                      <span className={`rule-status ${rule.isActive ? 'is-active' : 'is-paused'}`}>
                        {rule.isActive ? t('active') : t('paused')}
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
                      {formatMoney(rule.amountMinor)}
                    </strong>
                  </div>

                  <dl className="recurring-rule-details">
                    <div>
                      <dt>{t('frequency')}</dt>
                      <dd>{frequencyLabels[rule.frequency]}</dd>
                    </div>
                    <div>
                      <dt>{t('nextDate')}</dt>
                      <dd>{formatDate(rule.nextOccurrenceOn)}</dd>
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
                      disabled={!recurring.online || busy}
                    >
                      <Pencil aria-hidden="true" />
                      {t('edit')}
                    </button>
                    {rule.isActive ? (
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() => {
                          const date = formatDate(rule.nextOccurrenceOn)
                          if (window.confirm(t('skipRecurringConfirm', { name: rule.name, date }))) {
                            void recurring.skipRuleOccurrence(rule)
                          }
                        }}
                        disabled={!recurring.online || busy}
                      >
                        <CalendarX2 aria-hidden="true" />
                        {t('skipNextOccurrence')}
                      </button>
                    ) : null}
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => void recurring.setRuleActive(rule, !rule.isActive)}
                      disabled={!recurring.online || busy}
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
                    <button
                      className="button recurring-delete-button"
                      type="button"
                      onClick={() => setDeletingRule(rule)}
                      disabled={!recurring.online || busy}
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
      </div>

      {editorOpen || draft ? (
        <RecurringRuleDialog
          key={draft?.id ?? editingRule?.id ?? 'new'}
          rule={draft ? null : editingRule}
          draft={draft}
          accounts={accounts}
          categories={categories}
          saving={recurring.mutatingId === (editingRule?.id ?? 'new')}
          serverError={recurring.error}
          online={recurring.online}
          onClose={closeEditor}
          onCreate={createRule}
          onEdit={editRule}
        />
      ) : null}

      {deletingRule ? (
        <RecurringDeleteDialog
          rule={deletingRule}
          deleting={recurring.mutatingId === deletingRule.id}
          onClose={closeDelete}
          onConfirm={() => recurring.deleteRule(deletingRule)}
        />
      ) : null}
    </section>
  )
}
