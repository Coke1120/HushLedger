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
import { TransactionDialog } from './components/TransactionDialog'
import { TransactionFilterSummary } from './components/TransactionFilterSummary'
import { TransactionList } from './components/TransactionList'
import {
  TransactionToolbar,
  type TransactionClearingFilter,
  type TransactionFilter,
} from './components/TransactionToolbar'
import { useMoneyData } from './hooks/useMoneyData'
import { useI18n } from './i18n'
import { inclusiveMonthRangeDates, shiftMonth } from './lib/date'
import type { AiProviderSettings } from './lib/ai'
import { recurringRuleDraftFromTransaction } from './lib/recurringDraft'
import {
  transactionInputWithClearingStatus,
  transferInputWithClearingStatus,
} from './lib/reconciliation'
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
  const [month, setMonth] = useState(initialMonth)
  const [filter, setFilter] = useState<TransactionFilter>('all')
  const [clearingFilter, setClearingFilter] = useState<TransactionClearingFilter>('all')
  const [accountFilterId, setAccountFilterId] = useState<number | null>(null)
  const [registerAccountId, setRegisterAccountId] = useState<number | null>(null)
  const [registerMode, setRegisterMode] = useState<'review' | 'reconcile'>('review')
  const [categoryFilterId, setCategoryFilterId] = useState<number | null>(null)
  const [payeeFilter, setPayeeFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')
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
  const [importMode, setImportMode] = useState<'csv' | 'ai' | null>(null)
  const [aiSettings, setAiSettings] = useState(initialAiSettings)
  const [savedTransactionViews, setSavedTransactionViews] = useState<SavedTransactionView[]>([])
  const [ledgerGeneration, setLedgerGeneration] = useState(0)
  const mainRef = useRef<HTMLElement>(null)
  const csvImportButtonRef = useRef<HTMLButtonElement>(null)
  const aiImportButtonRef = useRef<HTMLButtonElement>(null)
  const importPanelRef = useRef<HTMLElement>(null)
  const initialViewRef = useRef(true)
  const deferredSearch = useDeferredValue(search)
  const selectedMonthDateRange = inclusiveMonthRangeDates(month)
  const transactionDateRange = customTransactionDateRange ?? {
    from: selectedMonthDateRange.start,
    to: selectedMonthDateRange.end,
  }
  const effectiveTransactionDateScope = view === 'transactions' && registerAccountId === null
    ? transactionDateScope
    : 'month'
  const data = useMoneyData(
    month,
    filter,
    deferredSearch,
    accountFilterId,
    categoryFilterId,
    payeeFilter,
    tagFilter,
    clearingFilter,
    view === 'transactions' ? transactionSort : 'date_desc',
    duplicatesOnly,
    effectiveTransactionDateScope,
    transactionDateRange.from,
    transactionDateRange.to,
    registerAccountId,
  )
  const {
    clearActionMessage,
    refresh: refreshMoneyData,
    removeTransaction,
    removeAccountTransfer,
    setSelectedTransactionsCategory,
    setSelectedTransactionsClearing,
    saveAccountTransfer,
    saveTransaction: saveMoneyTransaction,
  } = data

  const openDialog = useCallback(() => {
    clearActionMessage()
    setEditingTransaction(null)
    setTransactionDraft(null)
    setDialogOpen(true)
  }, [clearActionMessage])

  const openTransaction = useCallback((transaction: Transaction) => {
    clearActionMessage()
    setEditingTransaction(transaction)
    setTransactionDraft(null)
    setDialogOpen(true)
  }, [clearActionMessage])

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
    clearActionMessage()
    setEditingTransfer(transfer)
    setTransferDialogOpen(true)
  }, [clearActionMessage])
  const closeTransferDialog = useCallback(() => {
    setTransferDialogOpen(false)
    setEditingTransfer(null)
  }, [])
  const closeRecurringDraft = useCallback(() => setRecurringDraft(null), [])

  const saveTransaction = useCallback(
    async (input: TransactionInput) => saveMoneyTransaction(input, editingTransaction ?? undefined),
    [editingTransaction, saveMoneyTransaction],
  )
  const saveTransfer = useCallback(
    async (input: AccountTransferInput) => saveAccountTransfer(input, editingTransfer ?? undefined),
    [editingTransfer, saveAccountTransfer],
  )
  const setRegisterTransactionCleared = useCallback(
    async (transaction: Transaction, cleared: boolean) => saveMoneyTransaction(
      transactionInputWithClearingStatus(transaction, cleared),
      transaction,
    ),
    [saveMoneyTransaction],
  )
  const setRegisterTransferCleared = useCallback(
    async (transfer: AccountTransfer, accountId: number, cleared: boolean) => saveAccountTransfer(
      transferInputWithClearingStatus(transfer, accountId, cleared),
      transfer,
    ),
    [saveAccountTransfer],
  )

  const changeView = useCallback((nextView: AppView) => {
    if (nextView !== 'transactions') setRegisterAccountId(null)
    setView(nextView)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

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
    setRegisterAccountId(null)
    setView('transactions')
    setImportMode(mode)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

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
    setTransactionDateScope('month')
    setTagFilter(null)
    setDuplicatesOnly(false)
    setFilter(category.type)
    setAccountFilterId(null)
    setRegisterAccountId(null)
    setCategoryFilterId(category.id)
    setPayeeFilter(null)
    setImportMode(null)
    changeView('transactions')
  }, [changeView, data.categories])

  const openPayeeTransactions = useCallback((payee: string) => {
    setSearch('')
    setTransactionDateScope('month')
    setTagFilter(null)
    setDuplicatesOnly(false)
    setFilter('expense')
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
    setTransactionDateScope('month')
    setTagFilter(null)
    setFilter('all')
    setClearingFilter('all')
    setDuplicatesOnly(false)
    setPayeeFilter(null)
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
    setAccountFilterId(registerAccountId)
    setRegisterAccountId(null)
    setRegisterMode('review')
  }, [registerAccountId])

  const changeTagFilter = useCallback((tag: string | null) => {
    setTagFilter(tag)
    if (!tag) return
    if (view !== 'transactions') setTransactionDateScope('month')
    setImportMode(null)
    changeView('transactions')
  }, [changeView, view])

  const openRecurringRules = useCallback(() => {
    setImportMode(null)
    changeView('recurring')
  }, [changeView])

  const handleLedgerRestored = useCallback(async () => {
    setSavedTransactionViews([])
    const savedViewsCleared = forgetSavedTransactionViews(() => window.localStorage)
    const refreshed = await refreshMoneyData(false)
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
      accountId: accountFilterId,
      categoryId: categoryFilterId,
      payee: payeeFilter,
      search: search.trim(),
      tag: tagFilter,
      duplicates: duplicatesOnly,
      sort: transactionSort,
    }
    storeSavedTransactionViews((current) => addSavedTransactionView(current, candidate).views)
  }, [accountFilterId, categoryFilterId, clearingFilter, duplicatesOnly, filter, payeeFilter, search, storeSavedTransactionViews, tagFilter, transactionDateRange.from, transactionDateRange.to, transactionDateScope, transactionSort])

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
    setAccountFilterId(accountId)
    setCategoryFilterId(categoryId)
    setPayeeFilter(savedView.payee)
    setSearch(savedView.search)
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
    setAccountFilterId(null)
    setCategoryFilterId(null)
    setPayeeFilter(null)
    setSearch('')
    setTagFilter(null)
    setDuplicatesOnly(false)
    setTransactionSort('date_desc')
    setCustomTransactionDateRange(null)
    setImportMode(null)
    setRegisterAccountId(null)
  }, [])

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

  return (
    <div className="app-shell">
      <AppHeader view={view} onAdd={openDialog} onViewChange={changeView} />
      <main
        className={`app-main view-${view}`}
        ref={mainRef}
        tabIndex={-1}
        aria-labelledby="app-view-title"
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
              onChange={setMonth}
              onPrevious={() => setMonth((value) => shiftMonth(value, -1))}
              onNext={() => setMonth((value) => shiftMonth(value, 1))}
            />
            <SummaryCards summary={data.summary} loading={loading} />
            {view === 'overview' ? (
              <>
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
                  loading={loading}
                  onSelectMonth={setMonth}
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
                  loading={loading}
                  onManage={openRecurringRules}
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
                onClick={() => {
                  setTransactionDateScope('month')
                  changeView('transactions')
                }}
              >
                {t('monthTransactions')}
                <ChevronRight aria-hidden="true" />
              </button>
              <TransactionToolbar
                search={search}
                payeeFilter={payeeFilter}
                tagFilter={tagFilter}
                filter={filter}
                clearingFilter={clearingFilter}
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
                onPayeeFilterChange={setPayeeFilter}
                onTagFilterChange={changeTagFilter}
                onFilterChange={changeTransactionFilter}
                onClearingFilterChange={setClearingFilter}
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
                      || accountFilterId !== null
                      || categoryFilterId !== null
                      || payeeFilter !== null
                      || search.trim().length > 0
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
                onImported={() => data.refresh(false)}
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
                onImported={() => data.refresh(false)}
              />
            ) : null}
            {view === 'transactions' && registerAccountId !== null ? (
              <AccountRegister
                register={data.accountRegister}
                balance={data.accountBalances.find(({ accountId }) => accountId === registerAccountId) ?? null}
                transactions={data.transactions}
                transfers={data.accountTransfers}
                loading={loading}
                saving={data.saving}
                reconcileInitially={registerMode === 'reconcile'}
                onClose={closeAccountRegister}
                onEditTransaction={openTransaction}
                onEditTransfer={openTransferDialog}
                onSetTransactionCleared={setRegisterTransactionCleared}
                onSetTransferCleared={setRegisterTransferCleared}
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
              <TransactionList
                key={[
                  month,
                  transactionDateScope,
                  transactionDateRange.from,
                  transactionDateRange.to,
                  view,
                  filter,
                  clearingFilter,
                  accountFilterId,
                  categoryFilterId,
                  payeeFilter,
                  deferredSearch,
                  tagFilter,
                  duplicatesOnly,
                  transactionSort,
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
              />
            ) : null}
          </section>
        </div>
        <div hidden={view !== 'recurring'}>
          <RecurringRulesPage
            key={`${ledgerGeneration}:${data.ledgerSettings.updatedAt}`}
            accounts={data.accounts}
            categories={data.categories}
            draft={recurringDraft}
            mutable={data.source === 'live' && data.online}
            onMoneyRefresh={data.refresh}
            onDraftClose={closeRecurringDraft}
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
            onReferenceRefresh={() => data.refresh(false)}
            onLedgerRestored={handleLedgerRestored}
          />
        </div>
      </main>

      <MobileNavigation view={view} onChange={changeView} />
      {dialogOpen ? (
        <TransactionDialog
          key={`${editingTransaction ? `edit:${editingTransaction.id}` : transactionDraft ? `duplicate:${transactionDraft.id}` : 'new'}:${data.ledgerSettings.updatedAt}`}
          accounts={data.accounts}
          categories={data.categories}
          saving={data.saving}
          serverError={data.saveError}
          online={data.online}
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
          key={`${editingTransfer ? `transfer:${editingTransfer.id}` : 'new-transfer'}:${data.ledgerSettings.updatedAt}`}
          accounts={data.accounts}
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
