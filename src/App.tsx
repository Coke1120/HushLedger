'use client'

import { ChevronRight } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { BankImportPanel } from './components/BankImportPanel'
import { AccountTransferDialog } from './components/AccountTransferDialog'
import { AccountTransferList } from './components/AccountTransferList'
import { AccountBalances } from './components/AccountBalances'
import { AccountRegister } from './components/AccountRegister'
import { CategorySpending } from './components/CategorySpending'
import { ConnectionBanner } from './components/ConnectionBanner'
import { CsvImportPanel } from './components/CsvImportPanel'
import { EmergencyFundProgress } from './components/EmergencyFundProgress'
import { IncomeSources } from './components/IncomeSources'
import { LedgerBackupReminder } from './components/LedgerBackupReminder'
import { MobileNavigation, type AppView } from './components/MobileNavigation'
import { MonthNavigator } from './components/MonthNavigator'
import { MonthlySpendingPlans } from './components/MonthlySpendingPlans'
import { NetWorthTrend } from './components/NetWorthTrend'
import { RecurringRulesPage } from './components/RecurringRulesPage'
import { RecurringForecast } from './components/RecurringForecast'
import { SavedTransactionViews } from './components/SavedTransactionViews'
import { SettingsPage } from './components/SettingsPage'
import { SummaryCards } from './components/SummaryCards'
import { CashFlowTrend } from './components/CashFlowTrend'
import { useAppUpdate } from './components/appUpdateContext'
import { TransactionDialog } from './components/TransactionDialog'
import { TransactionFilterSummary } from './components/TransactionFilterSummary'
import { TransactionList } from './components/TransactionList'
import {
  TransactionToolbar,
  type TransactionClearingFilter,
  type TransactionFilter,
  type TransactionImportReviewFilter,
} from './components/TransactionToolbar'
import { useHongKongToday } from './hooks/useHongKongToday'
import { useMoneyData } from './hooks/useMoneyData'
import { startScheduledOutlookRefreshRetries } from './hooks/scheduledOutlookRefresh'
import { useI18n } from './i18n'
import { inclusiveMonthRangeDates, shiftMonth } from './lib/date'
import type { AiProviderSettings } from './lib/ai'
import { recurringRuleDraftFromTransaction } from './lib/recurringDraft'
import { TRANSACTION_PAGE_SIZE } from './lib/schema'
import {
  addSavedTransactionView,
  applySavedTransactionViewsStorageChange,
  forgetSavedTransactionViews,
  parseSavedTransactionViews,
  SAVED_TRANSACTION_VIEWS_STORAGE_KEY,
  serializeSavedTransactionViews,
  type SavedTransactionView,
} from './lib/savedTransactionViews'
import type {
  RecurringRuleCreateInput,
  AccountTransfer,
  AccountTransferInput,
  Transaction,
  TransactionDateScope,
  TransactionInput,
  TransactionSort,
} from './lib/schema'
import { duplicateTransactionDraft } from './lib/transactionDraft'

const initialAiSettings: AiProviderSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
}

function App({ initialDate, initialMonth }: { initialDate: string; initialMonth: string }) {
  const { localizeEntityName, t } = useI18n()
  const scheduledOutlookToday = useHongKongToday()
  const { status: appUpdateStatus, setRestartBlocked } = useAppUpdate()
  const [month, setMonth] = useState(initialMonth)
  const [filter, setFilter] = useState<TransactionFilter>('all')
  const [clearingFilter, setClearingFilter] = useState<TransactionClearingFilter>('all')
  const [importReviewFilter, setImportReviewFilter] = useState<TransactionImportReviewFilter>('all')
  const [accountFilterId, setAccountFilterId] = useState<number | null>(null)
  const [registerAccountId, setRegisterAccountId] = useState<number | null>(null)
  const [registerMode, setRegisterMode] = useState<'review' | 'reconcile'>('review')
  const [registerDateRange, setRegisterDateRange] = useState<{
    month: string
    from: string
    to: string
  } | null>(null)
  const [categoryFilterId, setCategoryFilterId] = useState<number | null>(null)
  const [payeeFilter, setPayeeFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [amountFilterMinor, setAmountFilterMinor] = useState<number | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [transactionSort, setTransactionSort] = useState<TransactionSort>('date_desc')
  const [transactionDateScope, setTransactionDateScope] = useState<TransactionDateScope>('month')
  const [customTransactionDateRange, setCustomTransactionDateRange] = useState<{
    from: string
    to: string
  } | null>(null)
  const [duplicatesOnly, setDuplicatesOnly] = useState(false)
  const [view, setView] = useState<AppView>('overview')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [editingTransfer, setEditingTransfer] = useState<AccountTransfer | null>(null)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [transactionDraft, setTransactionDraft] = useState<TransactionInput | null>(null)
  const [recurringDraft, setRecurringDraft] = useState<RecurringRuleCreateInput | null>(null)
  const [recurringRuleFocusId, setRecurringRuleFocusId] = useState<string | null>(null)
  const [recurringTransferRuleFocusId, setRecurringTransferRuleFocusId] = useState<string | null>(null)
  const [importMode, setImportMode] = useState<'csv' | 'ai' | null>(null)
  const [aiSettings, setAiSettings] = useState(initialAiSettings)
  const [savedTransactionViews, setSavedTransactionViews] = useState<SavedTransactionView[]>([])
  const [ledgerGeneration, setLedgerGeneration] = useState(0)
  const [ledgerRestoreInProgress, setLedgerRestoreInProgress] = useState(false)
  const [importMutationInProgress, setImportMutationInProgress] = useState(false)
  const [recurringMutationInProgress, setRecurringMutationInProgress] = useState(false)
  const [settingsMutationInProgress, setSettingsMutationInProgress] = useState(false)
  const [ledgerBackupDue, setLedgerBackupDue] = useState<boolean | null>(null)
  const mainRef = useRef<HTMLElement>(null)
  const csvImportButtonRef = useRef<HTMLButtonElement>(null)
  const aiImportButtonRef = useRef<HTMLButtonElement>(null)
  const importPanelRef = useRef<HTMLElement>(null)
  const transactionLoadStatusRef = useRef<HTMLParagraphElement>(null)
  const initialViewRef = useRef(true)
  const deferredSearch = useDeferredValue(search)
  const selectedMonthDateRange = inclusiveMonthRangeDates(month)
  const transactionDateRange = customTransactionDateRange ?? {
    from: selectedMonthDateRange.start,
    to: selectedMonthDateRange.end,
  }
  const effectiveRegisterDateRange = registerDateRange?.month === month
    ? registerDateRange
    : { month, from: selectedMonthDateRange.start, to: selectedMonthDateRange.end }
  const effectiveTransactionDateScope = registerAccountId !== null
    ? 'range'
    : view === 'transactions' ? transactionDateScope : 'month'
  const effectiveTransactionDateRange = registerAccountId === null
    ? transactionDateRange
    : effectiveRegisterDateRange
  const data = useMoneyData(
    month,
    filter,
    deferredSearch,
    accountFilterId,
    categoryFilterId,
    payeeFilter,
    tagFilter,
    clearingFilter,
    importReviewFilter,
    view === 'transactions' ? transactionSort : 'date_desc',
    duplicatesOnly,
    effectiveTransactionDateScope,
    effectiveTransactionDateRange.from,
    effectiveTransactionDateRange.to,
    registerAccountId,
    registerAccountId === null ? amountFilterMinor : null,
  )
  const {
    clearActionMessage,
    refresh: refreshMoneyData,
    removeTransaction,
    removeAccountTransfer,
    setAccountRegisterEntryClearing,
    setSelectedTransactionsCategory,
    setSelectedTransactionsClearing,
    setSelectedTransactionsImportReviewStatus,
    saveAccountTransfer,
    saveTransaction: saveMoneyTransaction,
  } = data
  const otherLedgerMutationInProgress = data.saving
    || importMutationInProgress
    || recurringMutationInProgress
  const ledgerMutationInProgress = otherLedgerMutationInProgress || settingsMutationInProgress
  const ledgerInteractionLocked = ledgerRestoreInProgress || ledgerMutationInProgress
  const transactionEntryDisabled = ledgerInteractionLocked || data.source === 'loading'
  const scheduledOutlookStartOn = data.summary.scheduledOutlook?.startOn

  useEffect(() => {
    if (
      data.source !== 'live'
      || scheduledOutlookStartOn === undefined
      || scheduledOutlookStartOn === scheduledOutlookToday
      || ledgerInteractionLocked
    ) return

    return startScheduledOutlookRefreshRetries(
      () => refreshMoneyData('preserve'),
    )
  }, [
    data.source,
    ledgerInteractionLocked,
    refreshMoneyData,
    scheduledOutlookStartOn,
    scheduledOutlookToday,
  ])

  const changeLedgerRestoreState = useCallback((restoring: boolean) => {
    if (restoring && (ledgerMutationInProgress || appUpdateStatus === 'installing')) return false
    if (restoring) setRestartBlocked(true)
    setLedgerRestoreInProgress(restoring)
    return true
  }, [appUpdateStatus, ledgerMutationInProgress, setRestartBlocked])

  const openDialog = useCallback(() => {
    if (transactionEntryDisabled) return
    clearActionMessage()
    setEditingTransaction(null)
    setTransactionDraft(null)
    setDialogOpen(true)
  }, [clearActionMessage, transactionEntryDisabled])

  const openTransaction = useCallback((transaction: Transaction) => {
    if (ledgerInteractionLocked) return
    clearActionMessage()
    setEditingTransaction(transaction)
    setTransactionDraft(null)
    setDialogOpen(true)
  }, [clearActionMessage, ledgerInteractionLocked])

  const duplicateTransaction = useCallback((transaction: Transaction) => {
    clearActionMessage()
    setEditingTransaction(null)
    setTransactionDraft(duplicateTransactionDraft(transaction))
    setDialogOpen(true)
  }, [clearActionMessage])

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    setEditingTransaction(null)
    setTransactionDraft(null)
  }, [])
  const openTransferDialog = useCallback((transfer: AccountTransfer | null = null) => {
    if (ledgerInteractionLocked) return
    clearActionMessage()
    setEditingTransfer(transfer)
    setTransferDialogOpen(true)
  }, [clearActionMessage, ledgerInteractionLocked])
  const closeTransferDialog = useCallback(() => {
    setTransferDialogOpen(false)
    setEditingTransfer(null)
  }, [])
  const closeRecurringDraft = useCallback(() => setRecurringDraft(null), [])
  const clearRecurringRuleFocus = useCallback(() => setRecurringRuleFocusId(null), [])
  const clearRecurringTransferRuleFocus = useCallback(
    () => setRecurringTransferRuleFocusId(null),
    [],
  )

  const saveTransaction = useCallback(
    async (input: TransactionInput) => saveMoneyTransaction(input, editingTransaction ?? undefined),
    [editingTransaction, saveMoneyTransaction],
  )
  const saveTransfer = useCallback(
    async (input: AccountTransferInput) => saveAccountTransfer(input, editingTransfer ?? undefined),
    [editingTransfer, saveAccountTransfer],
  )
  const changeView = useCallback((nextView: AppView) => {
    if (ledgerInteractionLocked) return
    if (nextView !== 'transactions') setRegisterAccountId(null)
    if (nextView !== 'recurring') {
      setRecurringRuleFocusId(null)
      setRecurringTransferRuleFocusId(null)
    }
    setView(nextView)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [ledgerInteractionLocked])

  useEffect(() => {
    if (!ledgerRestoreInProgress) {
      setRestartBlocked(false)
      return
    }
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [ledgerRestoreInProgress, setRestartBlocked])

  const makeTransactionRecurring = useCallback((transaction: Transaction) => {
    const draftName = transaction.payee.trim() || localizeEntityName(
      transaction.categoryName,
      transaction.categoryLocalizationKey,
    )
    clearActionMessage()
    closeDialog()
    setImportMode(null)
    setRecurringDraft(recurringRuleDraftFromTransaction(transaction, draftName))
    changeView('recurring')
  }, [changeView, clearActionMessage, closeDialog, localizeEntityName])

  const openImport = useCallback((mode: 'csv' | 'ai') => {
    if (ledgerInteractionLocked) return
    setRegisterAccountId(null)
    setView('transactions')
    setImportMode(mode)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [ledgerInteractionLocked])

  const closeImport = useCallback(() => {
    const button = importMode === 'csv' ? csvImportButtonRef : aiImportButtonRef
    setImportMode(null)
    requestAnimationFrame(() => button.current?.focus())
  }, [importMode])

  const changeTransactionFilter = useCallback((nextFilter: TransactionFilter) => {
    setFilter(nextFilter)
    if (nextFilter === 'all') return
    setCategoryFilterId((currentCategoryId) => {
      const category = data.categories.find((item) => item.id === currentCategoryId)
      return category && category.type !== nextFilter ? null : currentCategoryId
    })
  }, [data.categories])

  const clearReferenceFilters = useCallback(() => {
    setAccountFilterId(null)
    setCategoryFilterId(null)
  }, [])

  const changeTransactionDateFrom = useCallback((from: string) => {
    const fallback = inclusiveMonthRangeDates(month)
    setCustomTransactionDateRange((current) => {
      const to = current?.to ?? fallback.end
      return { from, to: from > to ? from : to }
    })
  }, [month])

  const changeTransactionDateTo = useCallback((to: string) => {
    const fallback = inclusiveMonthRangeDates(month)
    setCustomTransactionDateRange((current) => {
      const from = current?.from ?? fallback.start
      return { from: to < from ? to : from, to }
    })
  }, [month])

  const openCategoryTransactions = useCallback((categoryId: number) => {
    const category = data.categories.find((item) => item.id === categoryId)
    if (!category) return
    setSearch('')
    setAmountFilterMinor(null)
    setTransactionDateScope('month')
    setTagFilter(null)
    setDuplicatesOnly(false)
    setFilter(category.type)
    setClearingFilter('all')
    setImportReviewFilter('all')
    setAccountFilterId(null)
    setRegisterAccountId(null)
    setCategoryFilterId(category.id)
    setPayeeFilter(null)
    setImportMode(null)
    changeView('transactions')
  }, [changeView, data.categories])

  const openPayeeTransactions = useCallback((payee: string) => {
    setSearch('')
    setAmountFilterMinor(null)
    setTransactionDateScope('month')
    setTagFilter(null)
    setDuplicatesOnly(false)
    setFilter('expense')
    setClearingFilter('all')
    setImportReviewFilter('all')
    setAccountFilterId(null)
    setRegisterAccountId(null)
    setCategoryFilterId(null)
    setPayeeFilter(payee)
    setImportMode(null)
    changeView('transactions')
  }, [changeView])

  const openAccountRegister = useCallback((accountId: number, mode: 'review' | 'reconcile') => {
    if (!data.accounts.some((account) => account.id === accountId)) return
    setSearch('')
    setAmountFilterMinor(null)
    setTransactionDateScope('month')
    setTagFilter(null)
    setFilter('all')
    setClearingFilter('all')
    setImportReviewFilter('all')
    setDuplicatesOnly(false)
    setPayeeFilter(null)
    setRegisterDateRange(null)
    if (data.source === 'live' && data.online) {
      setAccountFilterId(null)
      setRegisterAccountId(accountId)
      setRegisterMode(mode)
    } else {
      setAccountFilterId(accountId)
      setRegisterAccountId(null)
    }
    setCategoryFilterId(null)
    setTransactionSort('date_desc')
    setImportMode(null)
    changeView('transactions')
  }, [changeView, data.accounts, data.online, data.source])

  const openAccountTransactions = useCallback((accountId: number) => {
    openAccountRegister(accountId, 'review')
  }, [openAccountRegister])

  const openAccountReconciliation = useCallback((accountId: number) => {
    openAccountRegister(accountId, 'reconcile')
  }, [openAccountRegister])

  const closeAccountRegister = useCallback(() => {
    if (ledgerInteractionLocked) return
    setAccountFilterId(registerAccountId)
    setRegisterAccountId(null)
    setRegisterMode('review')
    setRegisterDateRange(null)
  }, [ledgerInteractionLocked, registerAccountId])

  const changeRegisterDateRange = useCallback((from: string, to: string) => {
    setRegisterDateRange({ month, from, to })
  }, [month])

  const changeTagFilter = useCallback((tag: string | null) => {
    setTagFilter(tag)
    if (!tag) return
    if (view !== 'transactions') setTransactionDateScope('month')
    setImportMode(null)
    changeView('transactions')
  }, [changeView, view])

  const openRecurringRules = useCallback((recurringRuleId: string) => {
    if (ledgerInteractionLocked) return
    setImportMode(null)
    setRecurringTransferRuleFocusId(null)
    setRecurringRuleFocusId(recurringRuleId)
    changeView('recurring')
  }, [changeView, ledgerInteractionLocked])

  const openRecurringTransferRules = useCallback((recurringTransferRuleId: string) => {
    if (ledgerInteractionLocked) return
    setImportMode(null)
    setRecurringRuleFocusId(null)
    setRecurringTransferRuleFocusId(recurringTransferRuleId)
    changeView('recurring')
  }, [changeView, ledgerInteractionLocked])

  const handleLedgerRestored = useCallback(async () => {
    setSavedTransactionViews([])
    const savedViewsCleared = forgetSavedTransactionViews(() => window.localStorage)
    const refreshed = await refreshMoneyData('error')
    setLedgerGeneration((generation) => generation + 1)
    return { refreshed, savedViewsCleared }
  }, [refreshMoneyData])

  const storeSavedTransactionViews = useCallback(
    (update: (current: SavedTransactionView[]) => SavedTransactionView[]) => {
      setSavedTransactionViews((current) => {
        const next = update(current)
        try {
          window.localStorage.setItem(
            SAVED_TRANSACTION_VIEWS_STORAGE_KEY,
            serializeSavedTransactionViews(next),
          )
        } catch {
          // The saved view remains available for this tab when browser storage is unavailable.
        }
        return next
      })
    },
    [],
  )

  const saveTransactionView = useCallback((name: string) => {
    const candidate: SavedTransactionView = {
      id: crypto.randomUUID(),
      name,
      scope: transactionDateScope,
      dateFrom: transactionDateScope === 'range' ? transactionDateRange.from : null,
      dateTo: transactionDateScope === 'range' ? transactionDateRange.to : null,
      type: filter,
      status: clearingFilter,
      importReviewStatus: importReviewFilter,
      accountId: accountFilterId,
      categoryId: categoryFilterId,
      payee: payeeFilter,
      search: search.trim(),
      amountMinor: amountFilterMinor,
      tag: tagFilter,
      duplicates: duplicatesOnly,
      sort: transactionSort,
    }
    storeSavedTransactionViews((current) => addSavedTransactionView(current, candidate).views)
  }, [accountFilterId, amountFilterMinor, categoryFilterId, clearingFilter, duplicatesOnly, filter, importReviewFilter, payeeFilter, search, storeSavedTransactionViews, tagFilter, transactionDateRange.from, transactionDateRange.to, transactionDateScope, transactionSort])

  const applySavedTransactionView = useCallback((savedView: SavedTransactionView) => {
    const accountId = savedView.accountId !== null
      && data.accounts.some(({ id }) => id === savedView.accountId)
      ? savedView.accountId
      : null
    const category = savedView.categoryId === null
      ? undefined
      : data.categories.find(({ id }) => id === savedView.categoryId)
    const categoryId = category && (savedView.type === 'all' || category.type === savedView.type)
      ? category.id
      : null
    setFilter(savedView.type)
    setTransactionDateScope(savedView.scope)
    if (savedView.scope === 'range' && savedView.dateFrom && savedView.dateTo) {
      setCustomTransactionDateRange({ from: savedView.dateFrom, to: savedView.dateTo })
    }
    setClearingFilter(savedView.status)
    setImportReviewFilter(savedView.importReviewStatus)
    setAccountFilterId(accountId)
    setCategoryFilterId(categoryId)
    setPayeeFilter(savedView.payee)
    setSearch(savedView.search)
    setAmountFilterMinor(savedView.amountMinor)
    setTagFilter(savedView.tag)
    setDuplicatesOnly(savedView.duplicates)
    setTransactionSort(savedView.sort)
    setImportMode(null)
    setRegisterAccountId(null)
  }, [data.accounts, data.categories])

  const resetTransactionFilters = useCallback(() => {
    setFilter('all')
    setTransactionDateScope('month')
    setClearingFilter('all')
    setImportReviewFilter('all')
    setAccountFilterId(null)
    setCategoryFilterId(null)
    setPayeeFilter(null)
    setSearch('')
    setAmountFilterMinor(null)
    setTagFilter(null)
    setDuplicatesOnly(false)
    setTransactionSort('date_desc')
    setCustomTransactionDateRange(null)
    setImportMode(null)
    setRegisterAccountId(null)
  }, [])

  const openSummaryTransactions = useCallback((nextFilter: TransactionFilter) => {
    if (ledgerInteractionLocked) return
    resetTransactionFilters()
    setFilter(nextFilter)
    changeView('transactions')
  }, [changeView, ledgerInteractionLocked, resetTransactionFilters])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        setSavedTransactionViews(parseSavedTransactionViews(
          window.localStorage.getItem(SAVED_TRANSACTION_VIEWS_STORAGE_KEY),
        ))
      } catch {
        // Saved views are optional when browser storage is unavailable.
      }
    }, 0)
    const syncSavedTransactionViews = (event: StorageEvent) => {
      let localStorage: Storage
      try {
        localStorage = window.localStorage
      } catch {
        return
      }
      if (event.storageArea !== localStorage) return
      setSavedTransactionViews((current) => applySavedTransactionViewsStorageChange(
        current,
        event.key,
        event.newValue,
      ))
    }
    window.addEventListener('storage', syncSavedTransactionViews)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('storage', syncSavedTransactionViews)
    }
  }, [])

  useEffect(() => {
    if (initialViewRef.current) {
      initialViewRef.current = false
      return
    }
    mainRef.current?.focus({ preventScroll: true })
  }, [view])

  useEffect(() => {
    if (view === 'transactions' && importMode) importPanelRef.current?.focus()
  }, [importMode, view])

  useEffect(() => {
    if (
      data.transactionPageLoadedMore
      && !data.transactionPageHasMore
      && !data.transactionPageLoading
    ) {
      transactionLoadStatusRef.current?.focus({ preventScroll: true })
    }
  }, [
    data.transactionPageHasMore,
    data.transactionPageLoadedMore,
    data.transactionPageLoading,
  ])

  const viewTitle =
    view === 'overview'
      ? t('overview')
      : view === 'transactions'
        ? t('transactions')
        : view === 'recurring'
          ? t('recurring')
          : t('settings')

  const transactions = view === 'overview' ? data.transactions.slice(0, 5) : data.transactions
  const loading = data.source === 'loading' || data.reportMonth !== month
  const moneyView = view === 'overview' || view === 'transactions'
  const transactionCountLabel = loading
    ? t('loadingTransactionCount')
    : data.transactionFilterSummary.transactionCount > data.transactions.length
      ? t('limitedTransactionCount', {
          visible: data.transactions.length,
          total: data.transactionFilterSummary.transactionCount,
        })
      : t('transactionCount', { count: data.transactionFilterSummary.transactionCount })
  const transactionLoadMoreCount = Math.min(
    TRANSACTION_PAGE_SIZE,
    Math.max(0, data.transactionFilterSummary.transactionCount - data.transactions.length),
  )

  return (
    <div className="app-shell">
      <AppHeader
        view={view}
        navigationDisabled={ledgerInteractionLocked}
        addDisabled={transactionEntryDisabled}
        onAdd={openDialog}
        onViewChange={changeView}
      />
      <main
        className={`app-main view-${view}`}
        ref={mainRef}
        tabIndex={-1}
        aria-labelledby="app-view-title"
        aria-busy={ledgerInteractionLocked || undefined}
      >
        <h1 className="sr-only" id="app-view-title">{viewTitle}</h1>
        <div hidden={!moneyView}>
          <ConnectionBanner
            source={data.source}
            online={data.online}
            actionMessage={data.actionMessage}
            onRetry={() => void data.refresh()}
          />
          <div className="overview-region">
            <MonthNavigator
              month={month}
              currentMonth={initialMonth}
              disabled={ledgerInteractionLocked}
              onChange={setMonth}
              onPrevious={() => setMonth((value) => shiftMonth(value, -1))}
              onNext={() => setMonth((value) => shiftMonth(value, 1))}
            />
            <SummaryCards
              summary={data.summary}
              loading={loading}
              disabled={ledgerInteractionLocked}
              onSelect={openSummaryTransactions}
            />
            {view === 'overview' ? (
              <>
                <LedgerBackupReminder
                  due={ledgerBackupDue}
                  live={data.source === 'live'}
                  disabled={ledgerInteractionLocked}
                  onReview={() => changeView('settings')}
                />
                <AccountBalances
                  balances={data.accountBalances}
                  month={month}
                  loading={loading}
                  canReconcile={data.source === 'live' && data.online}
                  onReview={openAccountTransactions}
                  onCompare={openAccountReconciliation}
                />
                <EmergencyFundProgress
                  goal={data.emergencyFundGoal}
                  balance={!loading && data.emergencyFundGoal
                    ? data.accountBalances.find(
                      ({ accountId }) => accountId === data.emergencyFundGoal?.accountId,
                    ) ?? null
                    : null}
                  month={month}
                  loading={loading}
                  canManage={data.source === 'live' && data.online}
                  onManage={() => changeView('settings')}
                />
                <NetWorthTrend
                  points={data.netWorthTrend}
                  month={month}
                  loading={loading}
                  onSelectMonth={setMonth}
                />
                <CashFlowTrend
                  summary={data.summary}
                  currentMonth={scheduledOutlookToday.slice(0, 7)}
                  loading={loading}
                  onSelectMonth={setMonth}
                />
                <IncomeSources
                  summary={data.summary}
                  loading={loading}
                  onSelect={openCategoryTransactions}
                />
                <CategorySpending
                  summary={data.summary}
                  loading={loading}
                  onSelectCategory={openCategoryTransactions}
                  onSelectPayee={openPayeeTransactions}
                />
                <MonthlySpendingPlans
                  summary={data.summary}
                  loading={loading}
                  onSelect={openCategoryTransactions}
                />
                <RecurringForecast
                  key={month}
                  summary={data.summary}
                  accounts={data.accounts}
                  categories={data.categories}
                  loading={loading}
                  onManage={openRecurringRules}
                  onManageTransfer={openRecurringTransferRules}
                />
              </>
            ) : null}
          </div>

          <section
            className="transactions-panel"
            aria-labelledby={registerAccountId === null ? 'transactions-title' : undefined}
            aria-label={registerAccountId !== null ? t('accountRegisterList') : undefined}
          >
            {registerAccountId === null ? <div className="transactions-heading">
              <div>
                <h2 id="transactions-title">{t('transactionRecords')}</h2>
                <p>{transactionCountLabel}</p>
              </div>
              <button
                className="view-all-button"
                type="button"
                disabled={ledgerInteractionLocked}
                onClick={() => openSummaryTransactions('all')}
              >
                {t('monthTransactions')}
                <ChevronRight aria-hidden="true" />
              </button>
              <TransactionToolbar
                search={search}
                amountFilterMinor={amountFilterMinor}
                payeeFilter={payeeFilter}
                tagFilter={tagFilter}
                filter={filter}
                clearingFilter={clearingFilter}
                importReviewFilter={importReviewFilter}
                dateScope={transactionDateScope}
                dateFrom={transactionDateRange.from}
                dateTo={transactionDateRange.to}
                duplicatesOnly={duplicatesOnly}
                sort={transactionSort}
                showSort={view === 'transactions'}
                month={month}
                currentDate={initialDate}
                accounts={data.accounts}
                categories={data.categories}
                accountFilterId={accountFilterId}
                categoryFilterId={categoryFilterId}
                canExport={data.source === 'live' && data.online}
                canImport={data.source === 'live' && data.online}
                onSearchChange={setSearch}
                onAmountFilterChange={setAmountFilterMinor}
                onPayeeFilterChange={setPayeeFilter}
                onTagFilterChange={changeTagFilter}
                onFilterChange={changeTransactionFilter}
                onClearingFilterChange={setClearingFilter}
                onImportReviewFilterChange={setImportReviewFilter}
                onDateScopeChange={setTransactionDateScope}
                onDateFromChange={changeTransactionDateFrom}
                onDateToChange={changeTransactionDateTo}
                onDuplicatesOnlyChange={setDuplicatesOnly}
                onSortChange={setTransactionSort}
                onAccountFilterChange={setAccountFilterId}
                onCategoryFilterChange={setCategoryFilterId}
                onClearReferenceFilters={clearReferenceFilters}
                onCsvImport={() => openImport('csv')}
                onAiImport={() => openImport('ai')}
                csvImportOpen={importMode === 'csv'}
                aiImportOpen={importMode === 'ai'}
                csvImportButtonRef={csvImportButtonRef}
                aiImportButtonRef={aiImportButtonRef}
              />
              {view === 'transactions' ? (
                <>
                  <TransactionFilterSummary
                    summary={data.transactionFilterSummary}
                    loading={loading}
                  />
                  <SavedTransactionViews
                    views={savedTransactionViews}
                    accounts={data.accounts}
                    categories={data.categories}
                    canSave={
                      filter !== 'all'
                      || transactionDateScope !== 'month'
                      || clearingFilter !== 'all'
                      || importReviewFilter !== 'all'
                      || accountFilterId !== null
                      || categoryFilterId !== null
                      || payeeFilter !== null
                      || search.trim().length > 0
                      || amountFilterMinor !== null
                      || tagFilter !== null
                      || duplicatesOnly
                      || transactionSort !== 'date_desc'
                    }
                    onSave={saveTransactionView}
                    onApply={applySavedTransactionView}
                    onDelete={(id) => storeSavedTransactionViews(
                      (current) => current.filter((view) => view.id !== id),
                    )}
                    onReset={resetTransactionFilters}
                  />
                </>
              ) : null}
            </div> : null}
            {registerAccountId === null && view === 'transactions' && importMode === 'csv' ? (
              <CsvImportPanel
                key={`csv-import-${data.ledgerSettings.updatedAt}`}
                accounts={data.accounts}
                categories={data.categories}
                available={data.source === 'live' && data.online}
                panelRef={importPanelRef}
                onClose={closeImport}
                onImported={() => data.refresh('error')}
                onMutationStateChange={setImportMutationInProgress}
              />
            ) : null}
            {registerAccountId === null && view === 'transactions' && importMode === 'ai' ? (
              <BankImportPanel
                key={`ai-import-${data.ledgerSettings.updatedAt}`}
                settings={aiSettings}
                accounts={data.accounts}
                categories={data.categories}
                available={data.source === 'live' && data.online}
                panelRef={importPanelRef}
                onClose={closeImport}
                onConfigure={() => changeView('settings')}
                onImported={() => data.refresh('error')}
                onMutationStateChange={setImportMutationInProgress}
              />
            ) : null}
            {view === 'transactions' && registerAccountId !== null ? (
              <AccountRegister
                key={`${registerAccountId}:${month}`}
                accountId={registerAccountId}
                currency={data.accounts.find((account) => account.id === registerAccountId)?.currency
                  ?? data.ledgerSettings.currency}
                register={data.accountRegister}
                canExport={data.source === 'live' && data.online}
                snapshotVersion={data.snapshotVersion}
                dateFrom={effectiveRegisterDateRange.from}
                dateTo={effectiveRegisterDateRange.to}
                transactions={data.transactions}
                transfers={data.accountTransfers}
                loading={loading}
                saving={ledgerInteractionLocked}
                reconcileInitially={registerMode === 'reconcile'}
                onClose={closeAccountRegister}
                onDateRangeChange={changeRegisterDateRange}
                onEditTransaction={openTransaction}
                onEditTransfer={openTransferDialog}
                onSetEntryCleared={setAccountRegisterEntryClearing}
              />
            ) : view === 'transactions' ? (
              <AccountTransferList
                transfers={data.accountTransfers}
                loading={loading}
                available={data.source === 'live' && data.online && data.accounts.filter(({ isActive }) => isActive).length >= 2}
                onAdd={() => openTransferDialog()}
                onEdit={openTransferDialog}
              />
            ) : null}
            {registerAccountId === null ? (
              <>
                <TransactionList
                  key={[
                    month,
                    transactionDateScope,
                    transactionDateRange.from,
                    transactionDateRange.to,
                    view,
                    filter,
                    clearingFilter,
                    importReviewFilter,
                    accountFilterId,
                    categoryFilterId,
                    payeeFilter,
                    amountFilterMinor,
                    deferredSearch,
                    tagFilter,
                    duplicatesOnly,
                    transactionSort,
                    data.snapshotVersion,
                  ].join('|')}
                  transactions={transactions}
                  categories={data.categories}
                  loading={loading}
                  tagFilter={tagFilter}
                  duplicateReview={duplicatesOnly}
                  allowBulkActions={view === 'transactions'}
                  saving={data.saving}
                  onEdit={openTransaction}
                  onTagSelect={changeTagFilter}
                  onSetCategory={setSelectedTransactionsCategory}
                  onSetClearing={setSelectedTransactionsClearing}
                  onSetImportReviewStatus={setSelectedTransactionsImportReviewStatus}
                />
                {view === 'transactions' && (
                  data.transactionPageHasMore
                  || data.transactionPageLoading
                  || data.transactionPageError
                  || data.transactionPageLoadedMore
                  || data.transactionPageRefreshRequired
                ) ? (
                  <div className="transaction-load-more" aria-live="polite">
                    {data.transactionPageHasMore ? (
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={ledgerInteractionLocked || data.transactionPageLoading}
                        onClick={() => void data.loadMoreTransactions()}
                      >
                        {t(data.transactionPageLoading
                          ? 'loadingMoreTransactions'
                          : 'loadMoreTransactions', { count: transactionLoadMoreCount })}
                      </button>
                    ) : null}
                    {data.transactionPageRefreshRequired ? (
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={ledgerInteractionLocked || data.transactionPageLoading}
                        onClick={() => void data.retryTransactionPageRefresh()}
                      >
                        {t('retry')}
                      </button>
                    ) : null}
                    {data.transactionPageError ? (
                      <p role="status">{data.transactionPageError}</p>
                    ) : !data.transactionPageHasMore && data.transactionPageLoadedMore ? (
                      <p ref={transactionLoadStatusRef} role="status" tabIndex={-1}>
                        {t('allMatchingTransactionsLoaded')}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </section>
        </div>
        <div hidden={view !== 'recurring'}>
          <RecurringRulesPage
            key={ledgerGeneration}
            active={view === 'recurring'}
            accounts={data.accounts}
            categories={data.categories}
            draft={recurringDraft}
            focusRuleId={recurringRuleFocusId}
            focusTransferRuleId={recurringTransferRuleFocusId}
            ledgerContext={data.ledgerSettings.updatedAt}
            ledgerSource={data.source}
            mutable={data.source === 'live' && data.online}
            onMoneyRefresh={data.refresh}
            onDraftClose={closeRecurringDraft}
            onFocusRuleHandled={clearRecurringRuleFocus}
            onFocusTransferRuleHandled={clearRecurringTransferRuleFocus}
            onMutationStateChange={setRecurringMutationInProgress}
          />
        </div>
        <div hidden={view !== 'settings'}>
          <SettingsPage
            aiSettings={aiSettings}
            onAiSettingsChange={setAiSettings}
            accounts={data.accounts}
            categories={data.categories}
            emergencyFundGoal={data.emergencyFundGoal}
            ledgerSettings={data.ledgerSettings}
            canManageReferences={data.source === 'live' && data.online}
            ledgerRestoreInProgress={ledgerRestoreInProgress}
            otherLedgerMutationInProgress={otherLedgerMutationInProgress}
            onBackupDueChange={setLedgerBackupDue}
            onReferenceRefresh={() => data.refresh('error')}
            onLedgerRestored={handleLedgerRestored}
            onLedgerMutationStateChange={setSettingsMutationInProgress}
            onLedgerRestoreStateChange={changeLedgerRestoreState}
          />
        </div>
      </main>

      <MobileNavigation
        view={view}
        disabled={ledgerInteractionLocked}
        addDisabled={transactionEntryDisabled}
        onChange={changeView}
        onAdd={openDialog}
      />
      {dialogOpen ? (
        <TransactionDialog
          key={`${ledgerGeneration}:${editingTransaction ? `edit:${editingTransaction.id}` : transactionDraft ? `duplicate:${transactionDraft.id}` : 'new'}`}
          accounts={data.accounts}
          categories={data.categories}
          ledgerContext={data.ledgerSettings.updatedAt}
          saving={data.saving}
          serverError={data.saveError}
          online={data.online}
          source={data.source}
          transaction={editingTransaction}
          draft={transactionDraft}
          onClose={closeDialog}
          onSubmit={saveTransaction}
          onDelete={removeTransaction}
          onDuplicate={duplicateTransaction}
          onMakeRecurring={makeTransactionRecurring}
        />
      ) : null}
      {transferDialogOpen ? (
        <AccountTransferDialog
          key={`${ledgerGeneration}:${editingTransfer ? `transfer:${editingTransfer.id}` : 'new-transfer'}`}
          accounts={data.accounts}
          ledgerContext={data.ledgerSettings.updatedAt}
          saving={data.saving}
          serverError={data.saveError}
          online={data.online}
          available={data.source === 'live' && data.online}
          transfer={editingTransfer}
          onClose={closeTransferDialog}
          onSubmit={saveTransfer}
          onDelete={removeAccountTransfer}
        />
      ) : null}
    </div>
  )
}

export default App
