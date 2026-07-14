import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createRecurringTransferRuleAction,
  deleteRecurringTransferRuleAction,
  runDueRecurringTransferRulesAction,
  setRecurringTransferRuleStatusAction,
  skipRecurringTransferRuleOccurrenceAction,
  updateRecurringTransferRuleAction,
} from '../app/actions'
import {
  message,
  messageForError,
  renderMessage,
  useI18n,
  type LocalizedMessage,
} from '../i18n'
import { api } from '../lib/api'
import { recurringGenerationNeedsAttention } from '../lib/recurrence'
import type {
  RecurringTransferGenerationResult,
  RecurringTransferRule,
  RecurringTransferRuleCreateInput,
  RecurringTransferRuleUpdateInput,
} from '../lib/schema'
import { actionData } from './actionResult'
import { subscribeToForegroundRefresh } from './foregroundRefresh'
import type { DataSource, RefreshFailureMode } from './useMoneyData'

type MutationOptions = {
  successMessage: LocalizedMessage | ((result: unknown) => LocalizedMessage)
  request: () => Promise<unknown>
}

function resolveSuccessMessage(value: MutationOptions['successMessage'], result?: unknown) {
  return typeof value === 'function' ? value(result) : value
}

export function useRecurringTransferRules(
  onMoneyRefresh: (failureMode?: RefreshFailureMode) => Promise<boolean>,
  mutable: boolean,
  ledgerSource: DataSource,
) {
  const { t } = useI18n()
  const [rules, setRules] = useState<RecurringTransferRule[]>([])
  const [source, setSource] = useState<DataSource>('loading')
  const [online, setOnline] = useState(true)
  const [actionMessage, setActionMessage] = useState<LocalizedMessage | null>(null)
  const [actionWarning, setActionWarning] = useState(false)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [mutatingId, setMutatingId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const requestSequence = useRef(0)
  const submitting = useRef(false)

  const refresh = useCallback(async (failureMode: RefreshFailureMode = 'demo') => {
    const sequence = ++requestSequence.current
    if (failureMode !== 'preserve') setError(null)

    if (ledgerSource !== 'live') {
      setRules([])
      setSource(ledgerSource === 'loading' ? 'loading' : 'demo')
      setOnline(navigator.onLine)
      return false
    }

    if (!navigator.onLine) {
      setOnline(false)
      if (failureMode === 'demo') {
        setRules([])
        setSource('demo')
      }
      return false
    }

    try {
      const nextRules = await api<RecurringTransferRule[]>('/api/recurring-transfer-rules')
      if (sequence !== requestSequence.current) return false
      setRules(nextRules)
      setSource('live')
      setOnline(true)
      setError(null)
      return true
    } catch (requestError) {
      if (sequence !== requestSequence.current) return false
      if (failureMode === 'demo') {
        setRules([])
        setSource('demo')
      } else if (failureMode === 'error') {
        setSource('error')
        setError(messageForError(requestError, 'scheduledTransferLoadFailed'))
      }
      return false
    }
  }, [ledgerSource])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timeout)
  }, [refresh])

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
      setRules([])
      setSource('demo')
      setActionMessage(message('scheduledTransferOfflineStatus'))
      setActionWarning(true)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refresh])

  const mutate = useCallback(async ({ successMessage, request }: MutationOptions) => {
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
        setError(message('scheduledTransferOfflineError'))
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
      setError(messageForError(mutationError, 'scheduledTransferUpdateFailed'))
      return false
    } finally {
      submitting.current = false
      setMutatingId(null)
    }
  }, [mutable, onMoneyRefresh, refresh, source])

  const createRule = useCallback(async (input: RecurringTransferRuleCreateInput) => {
    setMutatingId('new-transfer')
    return mutate({
      successMessage: message('scheduledTransferCreated'),
      request: () => actionData(createRecurringTransferRuleAction(input)),
    })
  }, [mutate])

  const editRule = useCallback(async (id: string, input: RecurringTransferRuleUpdateInput) => {
    setMutatingId(id)
    return mutate({
      successMessage: message('scheduledTransferUpdated'),
      request: () => actionData(updateRecurringTransferRuleAction(id, input)),
    })
  }, [mutate])

  const setRuleActive = useCallback(async (rule: RecurringTransferRule, isActive: boolean) => {
    setMutatingId(rule.id)
    return mutate({
      successMessage: message(isActive ? 'scheduledTransferResumed' : 'scheduledTransferPaused'),
      request: () => actionData(setRecurringTransferRuleStatusAction(rule.id, {
        isActive,
        revision: rule.revision,
      })),
    })
  }, [mutate])

  const skipRuleOccurrence = useCallback(async (rule: RecurringTransferRule) => {
    setMutatingId(rule.id)
    return mutate({
      successMessage: message('scheduledTransferSkipped'),
      request: () => actionData(skipRecurringTransferRuleOccurrenceAction(rule.id, {
        revision: rule.revision,
        nextOccurrenceOn: rule.nextOccurrenceOn,
      })),
    })
  }, [mutate])

  const deleteRule = useCallback(async (rule: RecurringTransferRule) => {
    setMutatingId(rule.id)
    return mutate({
      successMessage: message('scheduledTransferDeleted'),
      request: () => actionData(deleteRecurringTransferRuleAction(rule.id, {
        revision: rule.revision,
      })),
    })
  }, [mutate])

  const runDue = useCallback(async () => {
    if (!mutable || source !== 'live' || submitting.current) return false
    setRunning(true)
    setMutatingId('run-due-transfers')
    const result = await mutate({
      successMessage: (requestResult) => {
        const generation = requestResult as RecurringTransferGenerationResult
        const needsAttention = recurringGenerationNeedsAttention(generation)
        setActionWarning(needsAttention)
        return message(needsAttention ? 'scheduledTransferRunIncomplete' : 'scheduledTransferRunResult', {
          scanned: generation.scanned,
          created: generation.created,
          existing: generation.alreadyExisting,
          blocked: generation.blocked,
          truncated: generation.truncated,
          failed: generation.failed,
        })
      },
      request: () => actionData(runDueRecurringTransferRulesAction()),
    })
    setRunning(false)
    return result
  }, [mutable, mutate, source])

  const clearActionMessage = useCallback(() => {
    setActionMessage(null)
    setActionWarning(false)
    setError(null)
  }, [])

  return {
    rules,
    source,
    online,
    actionMessage: renderMessage(t, actionMessage),
    actionWarning,
    error: renderMessage(t, error),
    mutatingId,
    running,
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
