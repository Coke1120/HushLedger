import {
  ArrowRightLeft,
  CalendarCheck,
  CircleAlert,
  CloudOff,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useRecurringTransferRules } from '../hooks/useRecurringTransferRules'
import type { DataSource, RefreshFailureMode } from '../hooks/useMoneyData'
import { useI18n } from '../i18n'
import type {
  Account,
  RecurringTransferRule,
  RecurringTransferRuleCreateInput,
  RecurringTransferRuleUpdateInput,
} from '../lib/schema'
import { visibleRecurringTransferRules } from './recurringTransferVisibility'
import { RecurringTransferRuleDialog } from './RecurringTransferRuleDialog'
import { RecurringTransferRuleList } from './RecurringTransferRuleList'

type RecurringTransferRulesPanelProps = {
  accounts: Account[]
  ledgerContext: string
  ledgerSource: DataSource
  mutable: boolean
  onMoneyRefresh: (failureMode?: RefreshFailureMode) => Promise<boolean>
  onMutationStateChange: (mutating: boolean) => void
}

export function RecurringTransferRulesPanel({
  accounts,
  ledgerContext,
  ledgerSource,
  mutable,
  onMoneyRefresh,
  onMutationStateChange,
}: RecurringTransferRulesPanelProps) {
  const { t } = useI18n()
  const recurring = useRecurringTransferRules(onMoneyRefresh, mutable, ledgerSource)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<RecurringTransferRule | null>(null)
  const ledgerLive = ledgerSource === 'live'
  const visibleRules = visibleRecurringTransferRules(ledgerSource, recurring.rules)
  const mutationInProgress = recurring.running || recurring.mutatingId !== null
  const mutationsEnabled = ledgerLive
    && mutable
    && recurring.online
    && recurring.source === 'live'
    && !mutationInProgress
  const hasTransferAccounts = accounts.filter(({ isActive }) => isActive).length >= 2
  const canCreate = mutationsEnabled && hasTransferAccounts
  const loading = ledgerSource === 'loading'
    || (ledgerLive && recurring.source === 'loading')

  useEffect(() => {
    onMutationStateChange(mutationInProgress)
  }, [mutationInProgress, onMutationStateChange])

  useEffect(() => () => onMutationStateChange(false), [onMutationStateChange])

  const closeEditor = useCallback(() => {
    setEditorOpen(false)
    setEditingRule(null)
  }, [])

  useEffect(() => {
    if (ledgerLive) return
    const timeout = window.setTimeout(closeEditor, 0)
    return () => window.clearTimeout(timeout)
  }, [closeEditor, ledgerLive])

  const openCreate = () => {
    if (!canCreate) return
    recurring.clearActionMessage()
    setEditingRule(null)
    setEditorOpen(true)
  }

  const openEdit = (rule: RecurringTransferRule) => {
    recurring.clearActionMessage()
    setEditingRule(rule)
    setEditorOpen(true)
  }

  const createRule = useCallback(
    (input: RecurringTransferRuleCreateInput) => recurring.createRule(input),
    [recurring],
  )
  const editRule = useCallback(
    (id: string, input: RecurringTransferRuleUpdateInput) => recurring.editRule(id, input),
    [recurring],
  )

  const statusContent = (() => {
    if (!recurring.online) {
      return {
        className: 'recurring-status status-warning',
        icon: <CloudOff aria-hidden="true" />,
        text: t('scheduledTransferOfflineStatus'),
      }
    }
    if (loading) {
      return {
        className: 'recurring-status',
        icon: <LoaderCircle className="spin" aria-hidden="true" />,
        text: t('scheduledTransferLoadingStatus'),
      }
    }
    if (!ledgerLive) {
      return {
        className: 'recurring-status status-warning',
        icon: <Sparkles aria-hidden="true" />,
        text: t('scheduledTransferDemoStatus'),
      }
    }
    if (recurring.source === 'error' || recurring.error) {
      return {
        className: 'recurring-status status-error',
        icon: <CircleAlert aria-hidden="true" />,
        text: recurring.error || t('scheduledTransferLoadFailed'),
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
        text: t('scheduledTransferDemoStatus'),
      }
    }
    if (!hasTransferAccounts) {
      return {
        className: 'recurring-status status-warning',
        icon: <CircleAlert aria-hidden="true" />,
        text: t('scheduledTransferUnavailable'),
      }
    }
    return null
  })()

  return (
    <section className="recurring-panel recurring-transfer-panel" aria-labelledby="scheduled-transfers-title">
      <div className="recurring-panel-heading recurring-transfer-panel-heading">
        <div>
          <h3 id="scheduled-transfers-title"><ArrowRightLeft aria-hidden="true" />{t('scheduledTransfers')}</h3>
          <p>{t('scheduledTransfersDescription')}</p>
          <p>{loading ? t('loading') : t('scheduledTransferRuleCount', { count: visibleRules.length })}</p>
        </div>
        <div className="recurring-transfer-panel-actions">
          <button className="button button-secondary" type="button" onClick={() => void recurring.runDue()} disabled={!mutationsEnabled || recurring.running || loading}>
            {recurring.running ? <LoaderCircle className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {recurring.running ? t('checking') : t('generateDueTransfers')}
          </button>
          <button className="button button-primary" type="button" onClick={openCreate} disabled={!canCreate}>
            <Plus aria-hidden="true" />
            {t('addScheduledTransfer')}
          </button>
        </div>
      </div>

      {statusContent ? (
        <div className={`${statusContent.className} recurring-transfer-status`} role={recurring.error ? 'alert' : 'status'}>
          {statusContent.icon}
          <span>{statusContent.text}</span>
          {recurring.source === 'error' || recurring.error ? (
            <button type="button" onClick={() => void recurring.refresh('error')}>
              <RefreshCw aria-hidden="true" />
              {t('retry')}
            </button>
          ) : null}
        </div>
      ) : null}

      <RecurringTransferRuleList
        accounts={accounts}
        loading={loading}
        mutable={mutationsEnabled}
        mutatingId={recurring.mutatingId}
        rules={visibleRules}
        onCreate={openCreate}
        onDelete={recurring.deleteRule}
        onEdit={openEdit}
        onSetActive={recurring.setRuleActive}
        onSkip={recurring.skipRuleOccurrence}
      />

      {editorOpen && ledgerLive ? (
        <RecurringTransferRuleDialog
          key={editingRule?.id ?? 'new-transfer'}
          accounts={accounts}
          ledgerContext={ledgerContext}
          mutable={mutationsEnabled}
          rule={editingRule}
          saving={recurring.mutatingId === (editingRule?.id ?? 'new-transfer')}
          serverError={recurring.error}
          onClose={closeEditor}
          onCreate={createRule}
          onEdit={editRule}
        />
      ) : null}
    </section>
  )
}
