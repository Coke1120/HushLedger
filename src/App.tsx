import { ChevronRight } from 'lucide-react'
import { useCallback, useDeferredValue, useState } from 'react'
import './App.css'
import { AppHeader } from './components/AppHeader'
import { ConnectionBanner } from './components/ConnectionBanner'
import { MobileNavigation, type AppView } from './components/MobileNavigation'
import { MonthNavigator } from './components/MonthNavigator'
import { RecurringRulesPage } from './components/RecurringRulesPage'
import { SummaryCards } from './components/SummaryCards'
import { TransactionDialog } from './components/TransactionDialog'
import { TransactionList } from './components/TransactionList'
import { TransactionToolbar, type TransactionFilter } from './components/TransactionToolbar'
import { useMoneyData } from './hooks/useMoneyData'
import { currentHongKongDate, shiftMonth } from './lib/date'
import type { TransactionInput } from './lib/schema'

const currentMonth = currentHongKongDate().month

function App() {
  const [month, setMonth] = useState(currentMonth)
  const [filter, setFilter] = useState<TransactionFilter>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<AppView>('overview')
  const [dialogOpen, setDialogOpen] = useState(false)
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

  const transactions = view === 'overview' ? data.transactions.slice(0, 5) : data.transactions
  const loading = data.source === 'loading'
  const transactionCountLabel = loading
    ? '正在載入'
    : data.transactions.length === 200
      ? '顯示最近 200 筆交易'
      : `${data.transactions.length} 筆交易`

  return (
    <div className="app-shell">
      <AppHeader view={view} onAdd={openDialog} onViewChange={changeView} />
      <main className={`app-main view-${view}`}>
        <h1 className="sr-only">HushLedger 私人收支管理</h1>
        {view === 'recurring' ? (
          <RecurringRulesPage accounts={data.accounts} categories={data.categories} onMoneyRefresh={data.refresh} />
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
                  <h2 id="transactions-title">交易紀錄</h2>
                  <p>{transactionCountLabel}</p>
                </div>
                <button className="view-all-button" type="button" onClick={() => changeView('transactions')}>
                  本月交易
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
