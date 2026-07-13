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
  DEFAULT_LEDGER_CURRENCY,
  type LedgerCurrencySettings,
} from '../lib/currency'
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
  EmergencyFundGoal,
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
import { transactionQueryFromFilters } from '../lib/transactionQuery'
import { actionData } from './actionResult'

export type DataSource = 'loading' | 'live' | 'demo' | 'error'

type Snapshot = {
  reportMonth: string
  transactions: Transaction[]
  accountTransfers: AccountTransfer[]
  accountBalances: AccountBalance[]
  accountRegister: AccountRegister | null
  netWorthTrend: NetWorthTrendPoint[]
  transactionFilterSummary: TransactionFilterSummary
  summary: Summary
  accounts: Account[]
  categories: Category[]
  emergencyFundGoal: EmergencyFundGoal | null
  ledgerSettings: LedgerCurrencySettings
}

type TransactionQueryResult = {
  transactions: Transaction[]
  summary: TransactionFilterSummary
}

function demoSnapshot(
  month: string,
  type: TransactionType | 'all',
  search: string,
  accountId: number | null,
  categoryId: number | null,
  payee: string | null,
  tag: string | null,
  status: TransactionClearingStatus | 'all',
  sort: TransactionSort,
  duplicatesOnly: boolean,
  scope: TransactionDateScope,
  dateFrom: string,
  dateTo: string,
): Snapshot {
  return {
    reportMonth: month,
    transactions: getDemoTransactions(
      month, type, search, undefined, accountId, categoryId, tag, status, sort, duplicatesOnly, scope,
      dateFrom, dateTo, payee,
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
      dateFrom,
      dateTo,
      payee,
    ),
    summary: demoSummary(month),
    accounts: demoAccounts,
    categories: demoCategories,
    emergencyFundGoal: null,
    ledgerSettings: {
      currency: DEFAULT_LEDGER_CURRENCY,
      updatedAt: '1970-01-01T00:00:00.000Z',
      canChangeCurrency: false,
    },
  }
}

export function useMoneyData(
  month: string,
  type: TransactionType | 'all',
  search: string,
  accountId: number | null,
  categoryId: number | null,
  payee: string | null,
  tag: string | null,
  status: TransactionClearingStatus | 'all',
  sort: TransactionSort,
  duplicatesOnly: boolean,
  scope: TransactionDateScope,
  dateFrom: string,
  dateTo: string,
  registerAccountId: number | null,
) {
  const { setLedgerCurrency, t } = useI18n()
  const [snapshot, setSnapshot] = useState<Snapshot>(() => (
    demoSnapshot(
      month, type, search, accountId, categoryId, payee, tag, status, sort, duplicatesOnly, scope,
      dateFrom, dateTo,
    )
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
    const transactionQuery = transactionQueryFromFilters({
      month,
      scope,
      dateFrom,
      dateTo,
      type,
      status,
      accountId: effectiveAccountId,
      categoryId,
      payee,
      search,
      tag,
      duplicatesOnly,
      sort,
    })
    const transferQuery = new URLSearchParams({ month })
    if (effectiveAccountId !== null) transferQuery.set('accountId', String(effectiveAccountId))

    const [
      transactionResult,
      accountTransfers,
      accountBalances,
      accountRegister,
      netWorthTrend,
      summary,
      accounts,
      categories,
      emergencyFundGoal,
      ledgerSettings,
    ] = await Promise.all([
      api<TransactionQueryResult>('/api/transactions/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transactionQuery),
      }),
      api<AccountTransfer[]>(`/api/transfers?${transferQuery}`),
      api<AccountBalance[]>(`/api/accounts/balances?month=${encodeURIComponent(month)}`),
      registerAccountId === null
        ? Promise.resolve(null)
        : api<AccountRegister>(`/api/accounts/register?month=${encodeURIComponent(month)}&accountId=${registerAccountId}`),
      api<NetWorthTrendPoint[]>(`/api/reports/net-worth?month=${encodeURIComponent(month)}`),
      api<Summary>(`/api/summary?month=${encodeURIComponent(month)}`),
      api<Account[]>('/api/accounts'),
      api<Category[]>('/api/categories'),
      api<EmergencyFundGoal | null>('/api/emergency-fund-goal'),
      api<LedgerCurrencySettings>('/api/ledger-settings'),
    ])
    return {
      reportMonth: month,
      transactions: transactionResult.transactions,
      accountTransfers,
      accountBalances,
      accountRegister,
      netWorthTrend,
      transactionFilterSummary: transactionResult.summary,
      summary,
      accounts,
      categories,
      emergencyFundGoal,
      ledgerSettings,
    }
  }, [accountId, categoryId, dateFrom, dateTo, duplicatesOnly, month, payee, registerAccountId, scope, search, sort, status, tag, type])

  const refresh = useCallback(
    async (allowDemoFallback = true) => {
      const sequence = ++requestSequence.current
      setSaveError(null)

      if (!navigator.onLine) {
        setOnline(false)
        if (allowDemoFallback) {
          setLedgerCurrency(DEFAULT_LEDGER_CURRENCY)
          setSnapshot(demoSnapshot(
            month, type, search, accountId, categoryId, payee, tag, status, sort, duplicatesOnly, scope,
            dateFrom, dateTo,
          ))
          setSource('demo')
        }
        return false
      }

      try {
        const next = await fetchSnapshot()
        if (sequence !== requestSequence.current) return false
        setLedgerCurrency(next.ledgerSettings.currency)
        setSnapshot(next)
        setSource('live')
        setOnline(true)
        return true
      } catch {
        if (sequence !== requestSequence.current) return false
        if (allowDemoFallback) {
          setLedgerCurrency(DEFAULT_LEDGER_CURRENCY)
          setSnapshot(demoSnapshot(
            month, type, search, accountId, categoryId, payee, tag, status, sort, duplicatesOnly, scope,
            dateFrom, dateTo,
          ))
          setSource('demo')
        } else {
          setSource('error')
        }
        return false
      }
    },
    [accountId, categoryId, dateFrom, dateTo, duplicatesOnly, fetchSnapshot, month, payee, scope, search, setLedgerCurrency, sort, status, tag, type],
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
      setLedgerCurrency(DEFAULT_LEDGER_CURRENCY)
      setSnapshot(demoSnapshot(
        month, type, search, accountId, categoryId, payee, tag, status, sort, duplicatesOnly, scope,
        dateFrom, dateTo,
      ))
      setSource('demo')
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [accountId, categoryId, dateFrom, dateTo, duplicatesOnly, month, payee, refresh, scope, search, setLedgerCurrency, sort, status, tag, type])

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
            month, type, search, accountId, categoryId, payee, tag, status, sort, duplicatesOnly, scope,
            dateFrom, dateTo,
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
    [accountId, categoryId, dateFrom, dateTo, duplicatesOnly, month, payee, refresh, scope, search, sort, source, status, tag, type],
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
            month, type, search, accountId, categoryId, payee, tag, status, sort, duplicatesOnly, scope,
            dateFrom, dateTo,
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
    [accountId, categoryId, dateFrom, dateTo, duplicatesOnly, month, payee, refresh, scope, search, sort, source, status, tag, type],
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
            month, type, search, accountId, categoryId, payee, tag, status, sort, duplicatesOnly, scope,
            dateFrom, dateTo,
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
    [accountId, categoryId, dateFrom, dateTo, duplicatesOnly, month, payee, refresh, scope, search, sort, source, status, tag, type],
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
            month, type, search, accountId, categoryId, payee, tag, status, sort, duplicatesOnly, scope,
            dateFrom, dateTo,
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
    [accountId, categoryId, dateFrom, dateTo, duplicatesOnly, month, payee, refresh, scope, search, sort, source, status, tag, type],
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
              dateFrom, dateTo, payee,
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
              dateFrom,
              dateTo,
              payee,
            ),
            summary: demoSummary(month, t),
          }
        : snapshot,
    [accountId, categoryId, dateFrom, dateTo, duplicatesOnly, month, payee, scope, search, snapshot, sort, source, status, t, tag, type],
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
