import { useCallback, useEffect, useRef, useState } from 'react'
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

function demoSnapshot(month: string, type: TransactionType | 'all', search: string): Snapshot {
  return {
    transactions: getDemoTransactions(month, type, search),
    summary: demoSummary(month),
    accounts: demoAccounts,
    categories: demoCategories,
  }
}

export function useMoneyData(month: string, type: TransactionType | 'all', search: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => demoSnapshot(month, type, search))
  const [source, setSource] = useState<DataSource>('loading')
  const [online, setOnline] = useState(() => navigator.onLine)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
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
      setSaveError('')
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
      setSaveError('')
      setActionMessage('')

      try {
        if (!navigator.onLine) throw new Error('目前處於離線狀態，交易尚未儲存。請連線後再試。')

        if (source === 'demo') {
          addDemo(input)
          setSnapshot(demoSnapshot(month, type, search))
          setActionMessage('已加入展示資料；只保留在本次頁面，不會儲存到 Cloudflare。')
          return true
        }

        await api<Transaction>('/api/transactions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
        const refreshed = await refresh(false)
        setActionMessage(refreshed ? '交易已安全儲存。' : '交易已儲存，但畫面未能重新整理；請按重試。')
        return true
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : '交易未能儲存，請再試一次。')
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [month, refresh, search, source, type],
  )

  return {
    ...snapshot,
    source,
    online,
    saving,
    saveError,
    actionMessage,
    refresh,
    saveTransaction,
    clearActionMessage: () => setActionMessage(''),
  }
}
