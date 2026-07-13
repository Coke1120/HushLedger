'use client'

import { ChevronRight } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { BankImportPanel } from './components/BankImportPanel'
import { CategorySpending } from './components/CategorySpending'
import { ConnectionBanner } from './components/ConnectionBanner'
import { CsvImportPanel } from './components/CsvImportPanel'
import { MobileNavigation, type AppView } from './components/MobileNavigation'
import { MonthNavigator } from './components/MonthNavigator'
import { RecurringRulesPage } from './components/RecurringRulesPage'
import { RecurringForecast } from './components/RecurringForecast'
import { SettingsPage } from './components/SettingsPage'
import { SummaryCards } from './components/SummaryCards'
import { SpendingTrend } from './components/SpendingTrend'
import { TransactionDialog } from './components/TransactionDialog'
import { TransactionList } from './components/TransactionList'
import {
  TransactionToolbar,
  type TransactionClearingFilter,
  type TransactionFilter,
} from './components/TransactionToolbar'
import { useMoneyData } from './hooks/useMoneyData'
import { useI18n } from './i18n'
import { shiftMonth } from './lib/date'
import type { AiProviderSettings } from './lib/ai'
import { recurringRuleDraftFromTransaction } from './lib/recurringDraft'
import type { RecurringRuleCreateInput, Transaction, TransactionInput } from './lib/schema'
import { duplicateTransactionDraft } from './lib/transactionDraft'

const initialAiSettings: AiProviderSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
}

function App({ initialMonth }: { initialMonth: string }) {
  const { localizeEntityName, t } = useI18n()
  const [month, setMonth] = useState(initialMonth)
  const [filter, setFilter] = useState<TransactionFilter>('all')
  const [clearingFilter, setClearingFilter] = useState<TransactionClearingFilter>('all')
  const [accountFilterId, setAccountFilterId] = useState<number | null>(null)
  const [categoryFilterId, setCategoryFilterId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [view, setView] = useState<AppView>('overview')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [transactionDraft, setTransactionDraft] = useState<TransactionInput | null>(null)
  const [recurringDraft, setRecurringDraft] = useState<RecurringRuleCreateInput | null>(null)
  const [importMode, setImportMode] = useState<'csv' | 'ai' | null>(null)
  const [aiSettings, setAiSettings] = useState(initialAiSettings)
  const [ledgerGeneration, setLedgerGeneration] = useState(0)
  const mainRef = useRef<HTMLElement>(null)
  const csvImportButtonRef = useRef<HTMLButtonElement>(null)
  const aiImportButtonRef = useRef<HTMLButtonElement>(null)
  const importPanelRef = useRef<HTMLElement>(null)
  const initialViewRef = useRef(true)
  const deferredSearch = useDeferredValue(search)
  const data = useMoneyData(
    month,
    filter,
    deferredSearch,
    accountFilterId,
    categoryFilterId,
    tagFilter,
    clearingFilter,
  )
  const {
    clearActionMessage,
    refresh: refreshMoneyData,
    removeTransaction,
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
  const closeRecurringDraft = useCallback(() => setRecurringDraft(null), [])

  const saveTransaction = useCallback(
    async (input: TransactionInput) => saveMoneyTransaction(input, editingTransaction ?? undefined),
    [editingTransaction, saveMoneyTransaction],
  )

  const changeView = useCallback((nextView: AppView) => {
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

  const openCategoryTransactions = useCallback((categoryId: number) => {
    const category = data.categories.find((item) => item.id === categoryId)
    if (!category) return
    setSearch('')
    setTagFilter(null)
    setFilter(category.type)
    setAccountFilterId(null)
    setCategoryFilterId(category.id)
    setImportMode(null)
    changeView('transactions')
  }, [changeView, data.categories])

  const changeTagFilter = useCallback((tag: string | null) => {
    setTagFilter(tag)
    if (!tag) return
    setImportMode(null)
    changeView('transactions')
  }, [changeView])

  const openRecurringRules = useCallback(() => {
    setImportMode(null)
    changeView('recurring')
  }, [changeView])

  const handleLedgerRestored = useCallback(async () => {
    const refreshed = await refreshMoneyData(false)
    setLedgerGeneration((generation) => generation + 1)
    return refreshed
  }, [refreshMoneyData])

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
  const loading = data.source === 'loading'
  const moneyView = view === 'overview' || view === 'transactions'
  const transactionCountLabel = loading
    ? t('loadingTransactionCount')
    : data.transactions.length === 200
      ? t('latestTransactionCount')
      : t('transactionCount', { count: data.transactions.length })

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
                <SpendingTrend
                  summary={data.summary}
                  loading={loading}
                  onSelectMonth={setMonth}
                />
                <CategorySpending
                  summary={data.summary}
                  loading={loading}
                  onSelect={openCategoryTransactions}
                />
                <RecurringForecast
                  summary={data.summary}
                  loading={loading}
                  onManage={openRecurringRules}
                />
              </>
            ) : null}
          </div>

          <section className="transactions-panel" aria-labelledby="transactions-title">
            <div className="transactions-heading">
              <div>
                <h2 id="transactions-title">{t('transactionRecords')}</h2>
                <p>{transactionCountLabel}</p>
              </div>
              <button className="view-all-button" type="button" onClick={() => changeView('transactions')}>
                {t('monthTransactions')}
                <ChevronRight aria-hidden="true" />
              </button>
              <TransactionToolbar
                search={search}
                tagFilter={tagFilter}
                filter={filter}
                clearingFilter={clearingFilter}
                month={month}
                accounts={data.accounts}
                categories={data.categories}
                accountFilterId={accountFilterId}
                categoryFilterId={categoryFilterId}
                canExport={data.source === 'live' && data.online}
                canImport={data.source === 'live' && data.online}
                onSearchChange={setSearch}
                onTagFilterChange={changeTagFilter}
                onFilterChange={changeTransactionFilter}
                onClearingFilterChange={setClearingFilter}
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
            </div>
            {view === 'transactions' && importMode === 'csv' ? (
              <CsvImportPanel
                accounts={data.accounts}
                categories={data.categories}
                available={data.source === 'live' && data.online}
                panelRef={importPanelRef}
                onClose={closeImport}
                onImported={() => data.refresh(false)}
              />
            ) : null}
            {view === 'transactions' && importMode === 'ai' ? (
              <BankImportPanel
                settings={aiSettings}
                accounts={data.accounts}
                categories={data.categories}
                online={data.online}
                panelRef={importPanelRef}
                onClose={closeImport}
                onConfigure={() => changeView('settings')}
                onImported={() => data.refresh(false)}
              />
            ) : null}
            <TransactionList
              transactions={transactions}
              loading={loading}
              tagFilter={tagFilter}
              onEdit={openTransaction}
              onTagSelect={changeTagFilter}
            />
          </section>
        </div>
        <div hidden={view !== 'recurring'}>
          <RecurringRulesPage
            key={ledgerGeneration}
            accounts={data.accounts}
            categories={data.categories}
            draft={recurringDraft}
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
            canManageReferences={data.source === 'live' && data.online}
            onReferenceRefresh={() => data.refresh(false)}
            onLedgerRestored={handleLedgerRestored}
          />
        </div>
      </main>

      <MobileNavigation view={view} onChange={changeView} />
      {dialogOpen ? (
        <TransactionDialog
          key={editingTransaction ? `edit:${editingTransaction.id}` : transactionDraft ? `duplicate:${transactionDraft.id}` : 'new'}
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
    </div>
  )
}

export default App
