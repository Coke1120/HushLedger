import { ChevronRight } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import './App.css'
import { AppHeader } from './components/AppHeader'
import { ConnectionBanner } from './components/ConnectionBanner'
import { MobileNavigation, type AppView } from './components/MobileNavigation'
import { MonthNavigator } from './components/MonthNavigator'
import { RecurringRulesPage } from './components/RecurringRulesPage'
import { SettingsPage } from './components/SettingsPage'
import { SummaryCards } from './components/SummaryCards'
import { TransactionDialog } from './components/TransactionDialog'
import { TransactionList } from './components/TransactionList'
import { TransactionToolbar, type TransactionFilter } from './components/TransactionToolbar'
import { useMoneyData } from './hooks/useMoneyData'
import { useI18n } from './i18n'
import { currentHongKongDate, shiftMonth } from './lib/date'
import type { TransactionInput } from './lib/schema'

const currentMonth = currentHongKongDate().month

function App() {
  const { t } = useI18n()
  const [month, setMonth] = useState(currentMonth)
  const [filter, setFilter] = useState<TransactionFilter>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<AppView>('overview')
  const [dialogOpen, setDialogOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const initialViewRef = useRef(true)
  const deferredSearch = useDeferredValue(search)
  const data = useMoneyData(month, filter, deferredSearch)

  const openDialog = useCallback(() => {
    data.clearActionMessage()
    setDialogOpen(true)
  }, [data])

  const closeDialog = useCallback(() => setDialogOpen(false), [])

  const saveTransaction = useCallback(
    async (input: TransactionInput) => data.saveTransaction(input),
    [data],
  )

  const changeView = useCallback((nextView: AppView) => {
    setView(nextView)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (initialViewRef.current) {
      initialViewRef.current = false
      return
    }
    mainRef.current?.focus({ preventScroll: true })
  }, [view])

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
        {view === 'recurring' ? (
          <RecurringRulesPage accounts={data.accounts} categories={data.categories} onMoneyRefresh={data.refresh} />
        ) : view === 'settings' ? (
          <SettingsPage />
        ) : (
          <>
            <ConnectionBanner
              source={data.source}
              online={data.online}
              actionMessage={data.actionMessage}
              onRetry={() => void data.refresh()}
            />
            <div className="overview-region">
              <MonthNavigator
                month={month}
                currentMonth={currentMonth}
                onChange={setMonth}
                onPrevious={() => setMonth((value) => shiftMonth(value, -1))}
                onNext={() => setMonth((value) => shiftMonth(value, 1))}
              />
              <SummaryCards summary={data.summary} loading={loading} />
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
                  filter={filter}
                  onSearchChange={setSearch}
                  onFilterChange={setFilter}
                />
              </div>
              <TransactionList transactions={transactions} loading={loading} />
            </section>
          </>
        )}
      </main>

      <MobileNavigation view={view} onChange={changeView} />
      {dialogOpen ? (
        <TransactionDialog
          accounts={data.accounts}
          categories={data.categories}
          saving={data.saving}
          serverError={data.saveError}
          online={data.online}
          onClose={closeDialog}
          onSubmit={saveTransaction}
        />
      ) : null}
    </div>
  )
}

export default App
