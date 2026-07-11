import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { currentHongKongDate } from '../lib/date'
import type {
  RecurringGenerationResult,
  RecurringRule,
  RecurringRuleCreateInput,
  RecurringRuleUpdateInput,
} from '../lib/schema'
import type { DataSource } from './useMoneyData'

type MutationOptions = {
  successMessage: string | ((result: unknown) => string)
  demoUpdate: (rules: RecurringRule[]) => RecurringRule[]
  request: () => Promise<unknown>
}

const today = currentHongKongDate().date

const demoRules: RecurringRule[] = [
  {
    id: '951b4d12-4aa8-4d8b-8947-648ae88c48af',
    name: '每月薪金',
    type: 'income',
    amountMinor: 3280000,
    currency: 'HKD',
    accountId: 2,
    categoryId: 1,
    frequency: 'monthly',
    scheduleStartsOn: today,
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
  },
]

function toRule(input: RecurringRuleCreateInput): RecurringRule {
  const timestamp = new Date().toISOString()
  return {
    ...input,
    scheduleStartsOn: input.scheduleStartsOn,
    nextOccurrenceOn: input.scheduleStartsOn,
    lastOccurrenceOn: null,
    anchorDay: Number(input.scheduleStartsOn.slice(-2)),
    generatedCount: 0,
    lastErrorCode: null,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function updateRule(rule: RecurringRule, input: RecurringRuleUpdateInput): RecurringRule {
  return {
    ...rule,
    ...input,
    scheduleStartsOn: input.scheduleStartsOn,
    nextOccurrenceOn: input.scheduleStartsOn,
    anchorDay: Number(input.scheduleStartsOn.slice(-2)),
    revision: rule.revision + 1,
    updatedAt: new Date().toISOString(),
  }
}

function resolveSuccessMessage(message: MutationOptions['successMessage'], result?: unknown) {
  return typeof message === 'function' ? message(result) : message
}

export function useRecurringRules(onMoneyRefresh: () => Promise<boolean>) {
  const [rules, setRules] = useState<RecurringRule[]>(demoRules)
  const [source, setSource] = useState<DataSource>('loading')
  const [online, setOnline] = useState(() => navigator.onLine)
  const [actionMessage, setActionMessage] = useState('')
  const [error, setError] = useState('')
  const [mutatingId, setMutatingId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const requestSequence = useRef(0)
  const submitting = useRef(false)

  const refresh = useCallback(async (allowDemoFallback = true) => {
    const sequence = ++requestSequence.current
    setError('')
    if (allowDemoFallback) setSource('loading')

    if (!navigator.onLine) {
      setOnline(false)
      if (allowDemoFallback) {
        setRules(demoRules)
        setSource('demo')
      }
      return false
    }

    try {
      const nextRules = await api<RecurringRule[]>('/api/recurring-rules')
      if (sequence !== requestSequence.current) return false
      setRules(nextRules)
      setSource('live')
      setOnline(true)
      return true
    } catch (requestError) {
      if (sequence !== requestSequence.current) return false
      if (allowDemoFallback) {
        setRules(demoRules)
        setSource('demo')
      } else {
        setSource('error')
        setError(requestError instanceof Error ? requestError.message : '未能重新載入週期交易。')
      }
      return false
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timeout)
  }, [refresh])

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true)
      void refresh()
    }
    const handleOffline = () => {
      setOnline(false)
      setRules(demoRules)
      setSource('demo')
      setActionMessage('目前離線，顯示示範週期交易；變更不會送出。')
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refresh])

  const mutate = useCallback(
    async ({ successMessage, demoUpdate, request }: MutationOptions) => {
      if (submitting.current) return false
      submitting.current = true
      setError('')
      setActionMessage('')

      try {
        if (!navigator.onLine) throw new Error('目前處於離線狀態，週期交易尚未變更。請連線後再試。')

        if (source === 'demo') {
          setRules(demoUpdate)
          setActionMessage(`${resolveSuccessMessage(successMessage)}（展示模式，不會永久儲存。）`)
          await onMoneyRefresh()
          return true
        }

        const requestResult = await request()
        const [rulesRefreshed] = await Promise.all([refresh(false), onMoneyRefresh()])
        const message = resolveSuccessMessage(successMessage, requestResult)
        setActionMessage(rulesRefreshed ? message : `${message} 畫面未能重新整理，請按重試。`)
        return true
      } catch (mutationError) {
        setError(mutationError instanceof Error ? mutationError.message : '未能更新週期交易，請再試一次。')
        return false
      } finally {
        submitting.current = false
        setMutatingId(null)
      }
    },
    [onMoneyRefresh, refresh, source],
  )

  const createRule = useCallback(
    async (input: RecurringRuleCreateInput) => {
      setMutatingId('new')
      return mutate({
        successMessage: '週期交易已建立，系統會按日期自動產生交易。',
        demoUpdate: (current) => [toRule(input), ...current],
        request: () =>
          api<RecurringRule>('/api/recurring-rules', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          }),
      })
    },
    [mutate],
  )

  const editRule = useCallback(
    async (id: string, input: RecurringRuleUpdateInput) => {
      setMutatingId(id)
      return mutate({
        successMessage: '週期交易已更新；已產生的歷史交易不會改動。',
        demoUpdate: (current) => current.map((rule) => (rule.id === id ? updateRule(rule, input) : rule)),
        request: () =>
          api<RecurringRule>(`/api/recurring-rules/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          }),
      })
    },
    [mutate],
  )

  const setRuleActive = useCallback(
    async (rule: RecurringRule, isActive: boolean) => {
      setMutatingId(rule.id)
      return mutate({
        successMessage: isActive ? '週期交易已恢復。' : '週期交易已暫停。',
        demoUpdate: (current) =>
          current.map((item) =>
            item.id === rule.id
              ? { ...item, isActive, revision: item.revision + 1, updatedAt: new Date().toISOString() }
              : item,
          ),
        request: () =>
          api<RecurringRule>(`/api/recurring-rules/${encodeURIComponent(rule.id)}/status`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ isActive, revision: rule.revision }),
          }),
      })
    },
    [mutate],
  )

  const deleteRule = useCallback(
    async (rule: RecurringRule) => {
      setMutatingId(rule.id)
      return mutate({
        successMessage: '週期交易已刪除；過往自動產生的交易仍然保留。',
        demoUpdate: (current) => current.filter((item) => item.id !== rule.id),
        request: () =>
          api<null>(`/api/recurring-rules/${encodeURIComponent(rule.id)}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ revision: rule.revision }),
          }),
      })
    },
    [mutate],
  )

  const runDue = useCallback(async () => {
    if (submitting.current) return false
    setRunning(true)
    setMutatingId('run-due')
    const result = await mutate({
      successMessage: (requestResult) => {
        if (!requestResult) return '已在展示模式模擬檢查到期交易。'
        const generation = requestResult as RecurringGenerationResult
        return `已檢查 ${generation.scanned} 項週期交易，新增 ${generation.created} 筆；另有 ${generation.alreadyExisting} 筆已存在。`
      },
      demoUpdate: (current) => current,
      request: () =>
        api<RecurringGenerationResult>('/api/recurring-rules/run-due', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }),
    })
    setRunning(false)
    return result
  }, [mutate])

  return {
    rules,
    source,
    online,
    actionMessage,
    error,
    mutatingId,
    running,
    refresh,
    createRule,
    editRule,
    setRuleActive,
    deleteRule,
    runDue,
    clearActionMessage: () => {
      setActionMessage('')
      setError('')
    },
  }
}
