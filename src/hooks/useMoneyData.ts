import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { message, messageForError, renderMessage, useI18n, type LocalizedMessage } from '../i18n'
import { api } from '../lib/api'
import { addDemo, demoAccounts, demoCategories, demoSummary, getDemoTransactions } from '../lib/demo'
import type { Account, Category, Summary, Transaction, TransactionInput, TransactionType } from '../lib/schema'

export type DataSource = 'loading' | 'live' | 'demo' | 'error'

type Snapshot = {
  transactions: Transaction[]
  summary: Summary
  accounts: Account[]
  categories: Category[]
}

function demoSnapshot(
  month: string,
  type: TransactionType | 'all',
  search: string,
): Snapshot {
  return {
    transactions: getDemoTransactions(month, type, search),
    summary: demoSummary(month),
    accounts: demoAccounts,
    categories: demoCategories,
  }
}

export function useMoneyData(month: string, type: TransactionType | 'all', search: string) {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState<Snapshot>(() => demoSnapshot(month, type, search))
  const [source, setSource] = useState<DataSource>('loading')
  const [online, setOnline] = useState(() => navigator.onLine)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<LocalizedMessage | null>(null)
  const [actionMessage, setActionMessage] = useState<LocalizedMessage | null>(null)
  const requestSequence = useRef(0)
  const submitting = useRef(false)

  const fetchSnapshot = useCallback(async (): Promise<Snapshot> => {
    const query = new URLSearchParams({ month })
    if (type !== 'all') query.set('type', type)
    if (search.trim()) query.set('search', search.trim())

    const [transactions, summary, accounts, categories] = await Promise.all([
      api<Transaction[]>(`/api/transactions?${query}`),
      api<Summary>(`/api/summary?month=${encodeURIComponent(month)}`),
      api<Account[]>('/api/accounts'),
      api<Category[]>('/api/categories'),
    ])
    return { transactions, summary, accounts, categories }
  }, [month, search, type])

  const refresh = useCallback(
    async (allowDemoFallback = true) => {
      const sequence = ++requestSequence.current
      setSaveError(null)
      if (allowDemoFallback) setSource('loading')

      if (!navigator.onLine) {
        setOnline(false)
        if (allowDemoFallback) {
          setSnapshot(demoSnapshot(month, type, search))
          setSource('demo')
        }
        return false
      }

      try {
        const next = await fetchSnapshot()
        if (sequence !== requestSequence.current) return false
        setSnapshot(next)
        setSource('live')
        setOnline(true)
        return true
      } catch {
        if (sequence !== requestSequence.current) return false
        if (allowDemoFallback) {
          setSnapshot(demoSnapshot(month, type, search))
          setSource('demo')
        } else {
          setSource('error')
        }
        return false
      }
    },
    [fetchSnapshot, month, search, type],
  )

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
      setSnapshot(demoSnapshot(month, type, search))
      setSource('demo')
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [month, refresh, search, type])

  const saveTransaction = useCallback(
    async (input: TransactionInput) => {
      if (submitting.current) return false
      submitting.current = true
      setSaving(true)
      setSaveError(null)
      setActionMessage(null)

      try {
        if (!navigator.onLine) {
          setSaveError(message('transactionOfflineError'))
          return false
        }

        if (source === 'demo') {
          addDemo(input)
          setSnapshot(demoSnapshot(month, type, search))
          setActionMessage(message('demoTransactionSaved'))
          return true
        }

        await api<Transaction>('/api/transactions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
        const refreshed = await refresh(false)
        setActionMessage(
          message(refreshed ? 'transactionSaved' : 'transactionSavedRefreshFailed'),
        )
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'transactionSaveFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [month, refresh, search, source, type],
  )

  const visibleSnapshot = useMemo(
    () =>
      source === 'demo'
        ? { ...snapshot, transactions: getDemoTransactions(month, type, search, t) }
        : snapshot,
    [month, search, snapshot, source, t, type],
  )

  return {
    ...visibleSnapshot,
    source,
    online,
    saving,
    saveError: renderMessage(t, saveError),
    actionMessage: renderMessage(t, actionMessage),
    refresh,
    saveTransaction,
    clearActionMessage: () => setActionMessage(null),
  }
}
