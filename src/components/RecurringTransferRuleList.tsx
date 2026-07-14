import {
  ArrowRightLeft,
  CalendarX2,
  CircleAlert,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from 'lucide-react'
import { useMemo } from 'react'
import { useI18n } from '../i18n'
import {
  orderRecurringRulesByUrgency,
  recurringRuleUrgency,
  type RecurringRuleUrgency,
} from '../lib/recurringUrgency'
import type { Account, RecurrenceFrequency, RecurringTransferRule } from '../lib/schema'

type RecurringTransferRuleListProps = {
  accounts: Account[]
  loading: boolean
  mutable: boolean
  mutatingId: string | null
  rules: RecurringTransferRule[]
  today: string
  onCreate: () => void
  onDelete: (rule: RecurringTransferRule) => Promise<boolean>
  onEdit: (rule: RecurringTransferRule) => void
  onSetActive: (rule: RecurringTransferRule, active: boolean) => Promise<boolean>
  onSkip: (rule: RecurringTransferRule) => Promise<boolean>
}

export function RecurringTransferRuleList({
  accounts,
  loading,
  mutable,
  mutatingId,
  rules,
  today,
  onCreate,
  onDelete,
  onEdit,
  onSetActive,
  onSkip,
}: RecurringTransferRuleListProps) {
  const { formatDate, formatMoney, localizeEntityName, t } = useI18n()
  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  )
  const frequencyLabels: Record<RecurrenceFrequency, string> = {
    daily: t('daily'),
    weekly: t('weekly'),
    monthly: t('monthly'),
    yearly: t('yearly'),
  }
  const canCreate = mutable && accounts.filter(({ isActive }) => isActive).length >= 2
  const orderedRules = useMemo(
    () => orderRecurringRulesByUrgency(rules, today),
    [rules, today],
  )

  const urgencyLabel = (urgency: RecurringRuleUrgency) => {
    if (urgency === 'overdue') return t('recurringOverdue')
    if (urgency === 'due_today') return t('recurringDueToday')
    if (urgency === 'due_soon') return t('recurringDueSoon')
    if (urgency === 'completed') return t('recurringCompleted')
    if (urgency === 'paused') return t('paused')
    return t('active')
  }

  if (loading) {
    return (
      <div className="recurring-empty" role="status">
        <LoaderCircle className="spin" aria-hidden="true" />
        {t('organizingScheduledTransfers')}
      </div>
    )
  }

  if (rules.length === 0) {
    return (
      <div className="recurring-empty recurring-transfer-empty">
        <span className="recurring-empty-icon" aria-hidden="true"><ArrowRightLeft /></span>
        <strong>{t('noScheduledTransfers')}</strong>
        <span>{t('noScheduledTransfersHelp')}</span>
        <button className="button button-primary" type="button" onClick={onCreate} disabled={!canCreate}>
          <Plus aria-hidden="true" />
          {t('addScheduledTransfer')}
        </button>
      </div>
    )
  }

  return (
    <ul className="recurring-list" aria-label={t('scheduledTransferRuleList')}>
      {orderedRules.map((rule) => {
        const busy = mutatingId === rule.id
        const urgency = recurringRuleUrgency(rule, today)
        const completed = urgency === 'completed'
        const source = accountsById.get(rule.fromAccountId)
        const destination = accountsById.get(rule.toAccountId)
        const sourceName = source
          ? localizeEntityName(source.name, source.localizationKey)
          : rule.fromAccountName || t('unknownAccount')
        const destinationName = destination
          ? localizeEntityName(destination.name, destination.localizationKey)
          : rule.toAccountName || t('unknownAccount')
        const direction = t('transferDirection', { from: sourceName, to: destinationName })

        return (
          <li
            className={`recurring-rule recurring-transfer-rule is-${urgency.replace('_', '-')}`}
            key={rule.id}
          >
            <div className="recurring-rule-main">
              <span className="recurring-rule-icon transfer" aria-hidden="true"><ArrowRightLeft /></span>
              <div className="recurring-rule-title">
                <span className={`rule-status is-${urgency.replace('_', '-')}`}>
                  {urgencyLabel(urgency)}
                </span>
                <strong>{rule.name}</strong>
                <small>{direction}</small>
              </div>
            </div>

            <div className="recurring-rule-amount">
              <span>{t('eachTime')}</span>
              <strong className="transfer">{formatMoney(rule.amountMinor, rule.currency)}</strong>
            </div>

            <dl className="recurring-rule-details recurring-transfer-rule-details">
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
                <dd>{rule.scheduleEndsOn ? formatDate(rule.scheduleEndsOn) : t('noScheduleEndDate')}</dd>
              </div>
              <div>
                <dt>{t('transferRoute')}</dt>
                <dd>{direction}</dd>
              </div>
              <div>
                <dt>{t('generated')}</dt>
                <dd>{t('generatedCount', { count: rule.generatedCount })}</dd>
              </div>
              {rule.note ? (
                <div className="recurring-transfer-note-detail">
                  <dt>{t('noteOptional')}</dt>
                  <dd>{rule.note}</dd>
                </div>
              ) : null}
            </dl>

            {rule.lastErrorCode ? (
              <p className="rule-error" role="status">
                <CircleAlert aria-hidden="true" />
                {t('scheduledTransferGenerationFailed')}
              </p>
            ) : null}

            <div className="recurring-rule-actions">
              <button className="button button-secondary" type="button" onClick={() => onEdit(rule)} disabled={!mutable || busy}>
                <Pencil aria-hidden="true" />
                {t('edit')}
              </button>
              {!completed && rule.isActive ? (
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    const date = formatDate(rule.nextOccurrenceOn)
                    if (window.confirm(t('skipScheduledTransferConfirm', { name: rule.name, date }))) {
                      void onSkip(rule)
                    }
                  }}
                  disabled={!mutable || busy}
                >
                  <CalendarX2 aria-hidden="true" />
                  {t('skipNextOccurrence')}
                </button>
              ) : null}
              {!completed ? (
                <button className="button button-secondary" type="button" onClick={() => void onSetActive(rule, !rule.isActive)} disabled={!mutable || busy}>
                  {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : rule.isActive ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                  {rule.isActive ? t('pause') : t('resume')}
                </button>
              ) : null}
              <button
                className="button recurring-delete-button"
                type="button"
                onClick={() => {
                  if (window.confirm(t('deleteScheduledTransferConfirm', {
                    name: rule.name,
                    count: rule.generatedCount,
                  }))) {
                    void onDelete(rule)
                  }
                }}
                disabled={!mutable || busy}
              >
                <Trash2 aria-hidden="true" />
                {t('delete')}
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
