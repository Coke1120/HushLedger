import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createAccountTransferAction,
  createTransactionAction,
  deleteAccountTransferAction,
  deleteTransactionAction,
  setTransactionsCategoryAction,
  setTransactionsClearingAction,
  updateAccountTransferAction,
  updateTransactionAction,
} from '../app/actions'
import { message, messageForError, renderMessage, useI18n, type LocalizedMessage } from '../i18n'
import { api } from '../lib/api'
import {
  addDemo,
  deleteDemo,
  demoAccounts,
  demoAccountBalances,
  demoCategories,
  demoNetWorthTrend,
  demoSummary,
  getDemoTransactions,
  setDemoTransactionsCategory,
  setDemoTransactionsClearing,
  summarizeDemoTransactions,
  updateDemo,
} from '../lib/demo'
import type {
  Account,
  AccountBalance,
  AccountRegister,
  AccountTransfer,
  AccountTransferInput,
  Category,
  NetWorthTrendPoint,
  Summary,
  Transaction,
  TransactionClearingStatus,
  TransactionDateScope,
  TransactionFilterSummary,
  TransactionInput,
  TransactionSort,
  TransactionType,
} from '../lib/schema'
import { actionData } from './actionResult'

export type DataSource = 'loading' | 'live' | 'demo' | 'error'

type Snapshot = {
  transactions: Transaction[]
  accountTransfers: AccountTransfer[]
  accountBalances: AccountBalance[]
  accountRegister: AccountRegister | null
  netWorthTrend: NetWorthTrendPoint[]
  transactionFilterSummary: TransactionFilterSummary
  summary: Summary
  accounts: Account[]
  categories: Category[]
}

function demoSnapshot(
  month: string,
  type: TransactionType | 'all',
  search: string,
  accountId: number | null,
  categoryId: number | null,
  tag: string | null,
  status: TransactionClearingStatus | 'all',
  sort: TransactionSort,
  duplicatesOnly: boolean,
  scope: TransactionDateScope,
): Snapshot {
  return {
    transactions: getDemoTransactions(
      month, type, search, undefined, accountId, categoryId, tag, status, sort, duplicatesOnly, scope,
    ),
    accountTransfers: [],
    accountBalances: demoAccountBalances(month),
    accountRegister: null,
    netWorthTrend: demoNetWorthTrend(month),
    transactionFilterSummary: summarizeDemoTransactions(
      month,
      type,
      search,
      undefined,
      accountId,
      categoryId,
      tag,
      status,
      duplicatesOnly,
      scope,
    ),
    summary: demoSummary(month),
    accounts: demoAccounts,
    categories: demoCategories,
  }
}

export function useMoneyData(
  month: string,
  type: TransactionType | 'all',
  search: string,
  accountId: number | null,
  categoryId: number | null,
  tag: string | null,
  status: TransactionClearingStatus | 'all',
  sort: TransactionSort,
  duplicatesOnly: boolean,
  scope: TransactionDateScope,
  registerAccountId: number | null,
) {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState<Snapshot>(() => (
    demoSnapshot(month, type, search, accountId, categoryId, tag, status, sort, duplicatesOnly, scope)
  ))
  const [source, setSource] = useState<DataSource>('loading')
  const [online, setOnline] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<LocalizedMessage | null>(null)
  const [actionMessage, setActionMessage] = useState<LocalizedMessage | null>(null)
  const requestSequence = useRef(0)
  const submitting = useRef(false)

  const fetchSnapshot = useCallback(async (): Promise<Snapshot> => {
    const effectiveAccountId = registerAccountId ?? accountId
    const query = new URLSearchParams({ month })
    if (scope === 'all') query.set('scope', scope)
    if (type !== 'all') query.set('type', type)
    if (effectiveAccountId !== null) query.set('accountId', String(effectiveAccountId))
    if (categoryId !== null) query.set('categoryId', String(categoryId))
    if (search.trim()) query.set('search', search.trim())
    if (tag) query.set('tag', tag.slice(1))
    if (status !== 'all') query.set('status', status)
    if (duplicatesOnly) query.set('duplicates', 'exact')
    const transactionQuery = new URLSearchParams(query)
    if (sort !== 'date_desc') transactionQuery.set('sort', sort)
    const transferQuery = new URLSearchParams({ month })
    if (effectiveAccountId !== null) transferQuery.set('accountId', String(effectiveAccountId))

    const [transactions, accountTransfers, accountBalances, accountRegister, netWorthTrend, transactionFilterSummary, summary, accounts, categories] = await Promise.all([
      api<Transaction[]>(`/api/transactions?${transactionQuery}`),
      api<AccountTransfer[]>(`/api/transfers?${transferQuery}`),
      api<AccountBalance[]>(`/api/accounts/balances?month=${encodeURIComponent(month)}`),
      registerAccountId === null
        ? Promise.resolve(null)
        : api<AccountRegister>(`/api/accounts/register?month=${encodeURIComponent(month)}&accountId=${registerAccountId}`),
      api<NetWorthTrendPoint[]>(`/api/reports/net-worth?month=${encodeURIComponent(month)}`),
      api<TransactionFilterSummary>(`/api/transactions/summary?${query}`),
      api<Summary>(`/api/summary?month=${encodeURIComponent(month)}`),
      api<Account[]>('/api/accounts'),
      api<Category[]>('/api/categories'),
    ])
    return { transactions, accountTransfers, accountBalances, accountRegister, netWorthTrend, transactionFilterSummary, summary, accounts, categories }
  }, [accountId, categoryId, duplicatesOnly, month, registerAccountId, scope, search, sort, status, tag, type])

  const refresh = useCallback(
    async (allowDemoFallback = true) => {
      const sequence = ++requestSequence.current
      setSaveError(null)

      if (!navigator.onLine) {
        setOnline(false)
        if (allowDemoFallback) {
          setSnapshot(demoSnapshot(
            month, type, search, accountId, categoryId, tag, status, sort, duplicatesOnly, scope,
          ))
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
          setSnapshot(demoSnapshot(
            month, type, search, accountId, categoryId, tag, status, sort, duplicatesOnly, scope,
          ))
          setSource('demo')
        } else {
          setSource('error')
        }
        return false
      }
    },
    [accountId, categoryId, duplicatesOnly, fetchSnapshot, month, scope, search, sort, status, tag, type],
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
      setSnapshot(demoSnapshot(
        month, type, search, accountId, categoryId, tag, status, sort, duplicatesOnly, scope,
      ))
      setSource('demo')
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [accountId, categoryId, duplicatesOnly, month, refresh, scope, search, sort, status, tag, type])

  const saveTransaction = useCallback(
    async (input: TransactionInput, original?: Transaction) => {
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
          if (original) updateDemo(input)
          else addDemo(input)
          setSnapshot(demoSnapshot(
            month, type, search, accountId, categoryId, tag, status, sort, duplicatesOnly, scope,
          ))
          setActionMessage(message(original ? 'demoTransactionChanged' : 'demoTransactionSaved'))
          return true
        }

        if (original) {
          const { id, ...fields } = input
          await actionData(updateTransactionAction(id, { ...fields, updatedAt: original.updatedAt }))
        } else {
          await actionData(createTransactionAction(input))
        }
        const refreshed = await refresh(false)
        setActionMessage(
          message(
            refreshed
              ? original
                ? 'transactionUpdated'
                : 'transactionSaved'
              : 'transactionSavedRefreshFailed',
          ),
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
    [accountId, categoryId, duplicatesOnly, month, refresh, scope, search, sort, source, status, tag, type],
  )

  const removeTransaction = useCallback(
    async (transaction: Transaction) => {
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
          deleteDemo(transaction.id)
          setSnapshot(demoSnapshot(
            month, type, search, accountId, categoryId, tag, status, sort, duplicatesOnly, scope,
          ))
          setActionMessage(message('demoTransactionChanged'))
          return true
        }

        await actionData(deleteTransactionAction(transaction.id, { updatedAt: transaction.updatedAt }))
        const refreshed = await refresh(false)
        setActionMessage(message(refreshed ? 'transactionDeleted' : 'transactionSavedRefreshFailed'))
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'transactionDeleteFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [accountId, categoryId, duplicatesOnly, month, refresh, scope, search, sort, source, status, tag, type],
  )

  const setSelectedTransactionsClearing = useCallback(
    async (transactions: Transaction[], cleared: boolean) => {
      if (submitting.current || transactions.length === 0) return false
      submitting.current = true
      setSaving(true)
      setSaveError(null)
      setActionMessage(null)

      const input = {
        cleared,
        transactions: transactions.map(({ id, updatedAt }) => ({ id, updatedAt })),
      }

      try {
        if (!navigator.onLine) {
          setSaveError(message('transactionOfflineError'))
          return false
        }

        if (source === 'demo') {
          const result = setDemoTransactionsClearing(input)
          if (result.kind === 'version_conflict') {
            setSaveError(message('errorTransactionVersionConflict'))
            return false
          }
          setSnapshot(demoSnapshot(
            month, type, search, accountId, categoryId, tag, status, sort, duplicatesOnly, scope,
          ))
        } else {
          await actionData(setTransactionsClearingAction(input))
          const refreshed = await refresh(false)
          if (!refreshed) {
            setActionMessage(message('transactionSavedRefreshFailed'))
            return true
          }
        }

        setActionMessage(message(
          transactions.length === 1
            ? 'bulkTransactionsClearingUpdatedOne'
            : 'bulkTransactionsClearingUpdated',
          {
            count: transactions.length,
            status: message(cleared ? 'cleared' : 'uncleared'),
          },
        ))
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'transactionBulkClearingFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [accountId, categoryId, duplicatesOnly, month, refresh, scope, search, sort, source, status, tag, type],
  )

  const setSelectedTransactionsCategory = useCallback(
    async (transactions: Transaction[], targetCategoryId: number) => {
      if (submitting.current || transactions.length === 0) return false
      submitting.current = true
      setSaving(true)
      setSaveError(null)
      setActionMessage(null)

      const input = {
        categoryId: targetCategoryId,
        transactions: transactions.map(({ id, updatedAt }) => ({ id, updatedAt })),
      }

      try {
        if (!navigator.onLine) {
          setSaveError(message('transactionOfflineError'))
          return false
        }

        if (source === 'demo') {
          const result = setDemoTransactionsCategory(input)
          if (result.kind === 'version_conflict') {
            setSaveError(message('errorTransactionVersionConflict'))
            return false
          }
          if (result.kind === 'reference_invalid') {
            setSaveError(message(
              result.code === 'CATEGORY_INVALID' ? 'errorCategoryInvalid' : 'errorCategoryMismatch',
            ))
            return false
          }
          setSnapshot(demoSnapshot(
            month, type, search, accountId, categoryId, tag, status, sort, duplicatesOnly, scope,
          ))
        } else {
          await actionData(setTransactionsCategoryAction(input))
          const refreshed = await refresh(false)
          if (!refreshed) {
            setActionMessage(message('transactionSavedRefreshFailed'))
            return true
          }
        }

        setActionMessage(message(
          transactions.length === 1
            ? 'bulkTransactionsCategoryUpdatedOne'
            : 'bulkTransactionsCategoryUpdated',
          { count: transactions.length },
        ))
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'transactionBulkCategoryFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [accountId, categoryId, duplicatesOnly, month, refresh, scope, search, sort, source, status, tag, type],
  )

  const saveAccountTransfer = useCallback(
    async (input: AccountTransferInput, original?: AccountTransfer) => {
      if (submitting.current) return false
      submitting.current = true
      setSaving(true)
      setSaveError(null)
      setActionMessage(null)

      try {
        if (!navigator.onLine || source !== 'live') {
          setSaveError(message(source === 'live' ? 'transferOfflineError' : 'transferUnavailable'))
          return false
        }

        if (original) {
          const { id, ...fields } = input
          await actionData(updateAccountTransferAction(id, {
            ...fields,
            updatedAt: original.updatedAt,
          }))
        } else {
          await actionData(createAccountTransferAction(input))
        }
        const refreshed = await refresh(false)
        setActionMessage(message(
          refreshed
            ? original ? 'transferUpdated' : 'transferSaved'
            : 'transactionSavedRefreshFailed',
        ))
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'transferSaveFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [refresh, source],
  )

  const removeAccountTransfer = useCallback(
    async (transfer: AccountTransfer) => {
      if (submitting.current) return false
      submitting.current = true
      setSaving(true)
      setSaveError(null)
      setActionMessage(null)

      try {
        if (!navigator.onLine || source !== 'live') {
          setSaveError(message(source === 'live' ? 'transferOfflineError' : 'transferUnavailable'))
          return false
        }
        await actionData(deleteAccountTransferAction(transfer.id, { updatedAt: transfer.updatedAt }))
        const refreshed = await refresh(false)
        setActionMessage(message(refreshed ? 'transferDeleted' : 'transactionSavedRefreshFailed'))
        return true
      } catch (error) {
        setSaveError(messageForError(error, 'transferDeleteFailed'))
        return false
      } finally {
        submitting.current = false
        setSaving(false)
      }
    },
    [refresh, source],
  )

  const visibleSnapshot = useMemo(
    () =>
      source === 'demo'
        ? {
            ...snapshot,
            transactions: getDemoTransactions(
              month, type, search, t, accountId, categoryId, tag, status, sort, duplicatesOnly, scope,
            ),
            transactionFilterSummary: summarizeDemoTransactions(
              month,
              type,
              search,
              t,
              accountId,
              categoryId,
              tag,
              status,
              duplicatesOnly,
              scope,
            ),
          }
        : snapshot,
    [accountId, categoryId, duplicatesOnly, month, scope, search, snapshot, sort, source, status, t, tag, type],
  )

  const clearActionMessage = useCallback(() => setActionMessage(null), [])

  return {
    ...visibleSnapshot,
    source,
    online,
    saving,
    saveError: renderMessage(t, saveError),
    actionMessage: renderMessage(t, actionMessage),
    refresh,
    saveTransaction,
    removeTransaction,
    setSelectedTransactionsCategory,
    setSelectedTransactionsClearing,
    saveAccountTransfer,
    removeAccountTransfer,
    clearActionMessage,
  }
}
