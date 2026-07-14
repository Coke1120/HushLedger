import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createRecurringRuleAction,
  deleteRecurringRuleAction,
  runDueRecurringRulesAction,
  setRecurringRuleStatusAction,
  skipRecurringRuleOccurrenceAction,
  updateRecurringRuleAction,
} from '../app/actions'
import {
  message,
  messageForError,
  renderMessage,
  supportedLocales,
  translate,
  useI18n,
  type LocalizedMessage,
  type Translator,
} from '../i18n'
import { api } from '../lib/api'
import { currentHongKongDate } from '../lib/date'
import { recurringGenerationNeedsAttention } from '../lib/recurrence'
import type {
  RecurringGenerationResult,
  RecurringRule,
  RecurringRuleCreateInput,
  RecurringRuleUpdateInput,
} from '../lib/schema'
import { actionData } from './actionResult'
import { subscribeToForegroundRefresh } from './foregroundRefresh'
import {
  recurringRuleReviewDataIsFresh,
  recurringRulesForLedgerSource,
  refreshRecurringRulesOnActivation,
} from './recurringRuleSource'
import type { DataSource, RefreshFailureMode } from './useMoneyData'

type MutationOptions = {
  successMessage: LocalizedMessage | ((result: unknown) => LocalizedMessage)
  request: () => Promise<unknown>
}

const today = currentHongKongDate().date
const DEMO_RULE_ID = '951b4d12-4aa8-4d8b-8947-648ae88c48af'

function createDemoRules(): RecurringRule[] {
  return [{
    id: DEMO_RULE_ID,
    name: '每月薪金',
    type: 'income',
    amountMinor: 3280000,
    currency: 'HKD',
    accountId: 2,
    categoryId: 1,
    frequency: 'monthly',
    scheduleStartsOn: today,
    scheduleEndsOn: null,
    nextOccurrenceOn: today,
    lastOccurrenceOn: null,
    anchorDay: Number(today.slice(-2)),
    generatedCount: 0,
    isActive: true,
    payee: '公司薪金',
    note: '展示用週期收入',
    lastErrorCode: null,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }]
}

const demoRules = createDemoRules()
const demoNames = new Set(supportedLocales.map((locale) => translate(locale, 'demoRecurringName')))
const demoPayees = new Set(supportedLocales.map((locale) => translate(locale, 'demoRecurringPayee')))
const demoNotes = new Set(supportedLocales.map((locale) => translate(locale, 'demoRecurringNote')))

function localizeDemoRule(rule: RecurringRule, t: Translator): RecurringRule {
  if (rule.id !== DEMO_RULE_ID) return rule
  return {
    ...rule,
    name: demoNames.has(rule.name) ? t('demoRecurringName') : rule.name,
    payee: demoPayees.has(rule.payee) ? t('demoRecurringPayee') : rule.payee,
    note: demoNotes.has(rule.note) ? t('demoRecurringNote') : rule.note,
  }
}

function resolveSuccessMessage(messageValue: MutationOptions['successMessage'], result?: unknown) {
  return typeof messageValue === 'function' ? messageValue(result) : messageValue
}

export function useRecurringRules(
  onMoneyRefresh: (failureMode?: RefreshFailureMode) => Promise<boolean>,
  mutable: boolean,
  ledgerSource: DataSource,
  active: boolean,
) {
  const { t } = useI18n()
  const [rules, setRules] = useState<RecurringRule[]>(demoRules)
  const [source, setSource] = useState<DataSource>('loading')
  const [online, setOnline] = useState(true)
  const [actionMessage, setActionMessage] = useState<LocalizedMessage | null>(null)
  const [actionWarning, setActionWarning] = useState(false)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [mutatingId, setMutatingId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const requestSequence = useRef(0)
  const submitting = useRef(false)
  const [lastActive, setLastActive] = useState(active)

  const refresh = useCallback(async (failureMode: RefreshFailureMode = 'demo') => {
    const sequence = ++requestSequence.current
    if (failureMode !== 'preserve') setError(null)

    if (ledgerSource !== 'live') {
      setRules(demoRules)
      setSource(ledgerSource === 'loading' ? 'loading' : 'demo')
      setOnline(navigator.onLine)
      return false
    }

    if (!navigator.onLine) {
      setOnline(false)
      if (failureMode === 'demo') {
        setRules(demoRules)
        setSource('demo')
      } else if (failureMode === 'error') {
        setSource('error')
        setError(message('recurringOfflineError'))
      }
      return false
    }

    try {
      const nextRules = await api<RecurringRule[]>('/api/recurring-rules')
      if (sequence !== requestSequence.current) return false
      setRules(nextRules)
      setSource('live')
      setOnline(true)
      setError(null)
      return true
    } catch (requestError) {
      if (sequence !== requestSequence.current) return false
      if (failureMode === 'demo') {
        setRules(demoRules)
        setSource('demo')
      } else if (failureMode === 'error') {
        setSource('error')
        setError(messageForError(requestError, 'recurringLoadFailed'))
      }
      return false
    }
  }, [ledgerSource])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timeout)
  }, [refresh])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextActive = refreshRecurringRulesOnActivation(
        lastActive,
        active,
        () => setSource('loading'),
        () => { void refresh('error') },
      )
      setLastActive(nextActive)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [active, lastActive, refresh])

  useEffect(() => subscribeToForegroundRefresh(
    document,
    () => source !== 'live' || !navigator.onLine || submitting.current,
    () => { void refresh('preserve') },
  ), [refresh, source])

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true)
      setActionMessage(null)
      setActionWarning(false)
      void refresh()
    }
    const handleOffline = () => {
      requestSequence.current += 1
      setOnline(false)
      setRules(demoRules)
      setSource('demo')
      setActionMessage(message('recurringOfflineDemo'))
      setActionWarning(true)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refresh])

  const mutate = useCallback(
    async ({ successMessage, request }: MutationOptions) => {
      if (!mutable || source !== 'live') {
        setMutatingId(null)
        return false
      }
      if (submitting.current) return false
      submitting.current = true
      setError(null)
      setActionMessage(null)
      setActionWarning(false)

      try {
        if (!navigator.onLine) {
          setError(message('recurringOfflineError'))
          return false
        }

        const requestResult = await request()
        const [rulesRefreshed] = await Promise.all([
          refresh('error'),
          onMoneyRefresh('error'),
        ])
        const success = resolveSuccessMessage(successMessage, requestResult)
        setActionMessage(
          rulesRefreshed ? success : message('recurringRefreshSuffix', { message: success }),
        )
        return true
      } catch (mutationError) {
        setError(messageForError(mutationError, 'recurringUpdateFailed'))
        return false
      } finally {
        submitting.current = false
        setMutatingId(null)
      }
    },
    [mutable, onMoneyRefresh, refresh, source],
  )

  const createRule = useCallback(
    async (input: RecurringRuleCreateInput) => {
      setMutatingId('new')
      return mutate({
        successMessage: message('recurringCreated'),
        request: () => actionData(createRecurringRuleAction(input)),
      })
    },
    [mutate],
  )

  const editRule = useCallback(
    async (id: string, input: RecurringRuleUpdateInput) => {
      setMutatingId(id)
      return mutate({
        successMessage: message('recurringUpdated'),
        request: () => actionData(updateRecurringRuleAction(id, input)),
      })
    },
    [mutate],
  )

  const setRuleActive = useCallback(
    async (rule: RecurringRule, isActive: boolean) => {
      setMutatingId(rule.id)
      return mutate({
        successMessage: message(isActive ? 'recurringResumed' : 'recurringPaused'),
        request: () => actionData(setRecurringRuleStatusAction(rule.id, {
          isActive,
          revision: rule.revision,
        })),
      })
    },
    [mutate],
  )

  const deleteRule = useCallback(
    async (rule: RecurringRule) => {
      setMutatingId(rule.id)
      return mutate({
        successMessage: message('recurringDeleted'),
        request: () => actionData(deleteRecurringRuleAction(rule.id, { revision: rule.revision })),
      })
    },
    [mutate],
  )

  const skipRuleOccurrence = useCallback(
    async (rule: RecurringRule) => {
      setMutatingId(rule.id)
      return mutate({
        successMessage: message('recurringSkipped'),
        request: () => actionData(skipRecurringRuleOccurrenceAction(rule.id, {
          revision: rule.revision,
          nextOccurrenceOn: rule.nextOccurrenceOn,
        })),
      })
    },
    [mutate],
  )

  const runDue = useCallback(async () => {
    if (!mutable || source !== 'live') return false
    if (submitting.current) return false
    setRunning(true)
    setMutatingId('run-due')
    const result = await mutate({
      successMessage: (requestResult) => {
        if (!requestResult) return message('recurringDemoRun')
        const generation = requestResult as RecurringGenerationResult
        const needsAttention = recurringGenerationNeedsAttention(generation)
        setActionWarning(needsAttention)
        return message(needsAttention ? 'recurringRunIncomplete' : 'recurringRunResult', {
          scanned: generation.scanned,
          created: generation.created,
          existing: generation.alreadyExisting,
          blocked: generation.blocked,
          truncated: generation.truncated,
          failed: generation.failed,
        })
      },
      request: () => actionData(runDueRecurringRulesAction()),
    })
    setRunning(false)
    return result
  }, [mutable, mutate, source])

  const visibleRules = useMemo(
    () => recurringRulesForLedgerSource(ledgerSource, rules, demoRules)
      .map((rule) => localizeDemoRule(rule, t)),
    [ledgerSource, rules, t],
  )
  const clearActionMessage = useCallback(() => {
    setActionMessage(null)
    setActionWarning(false)
    setError(null)
  }, [])

  return {
    rules: visibleRules,
    source,
    online,
    actionMessage: renderMessage(t, actionMessage),
    actionWarning,
    error: renderMessage(t, error),
    mutatingId,
    running,
    reviewDataFresh: recurringRuleReviewDataIsFresh(source, lastActive, active),
    refresh,
    createRule,
    editRule,
    setRuleActive,
    skipRuleOccurrence,
    deleteRule,
    runDue,
    clearActionMessage,
  }
}
