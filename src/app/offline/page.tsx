import { Banknote, CloudOff, House, ReceiptText, Utensils } from 'lucide-react'
import { connection } from 'next/server'

const demoTransactions = [
  { id: 1, Icon: Utensils, title: '超級市場', detail: '飲食 · 信用卡', date: '7月11日', amount: '−HK$386.40', type: 'expense' },
  { id: 2, Icon: ReceiptText, title: '電訊月費', detail: '帳單 · 銀行戶口', date: '7月8日', amount: '−HK$198.00', type: 'expense' },
  { id: 3, Icon: Banknote, title: '本月薪金', detail: '薪金 · 銀行戶口', date: '7月1日', amount: '+HK$52,000.00', type: 'income' },
] as const

export default async function OfflinePage() {
  await connection()

  return (
    <div className="app-shell" lang="zh-Hant">
      <header className="app-header">
        <div className="brand" aria-label="HushLedger">
          <span className="brand-mark" aria-hidden="true"><House /></span>
          <span className="brand-copy"><strong>HushLedger</strong><small>離線展示模式</small></span>
        </div>
      </header>
      <main className="app-main view-overview" aria-labelledby="offline-title">
        <h1 className="sr-only" id="offline-title">離線展示模式</h1>
        <div className="status-banner status-warning" role="status">
          <CloudOff aria-hidden="true" />
          <span>目前離線。以下只是展示資料；離線時不會儲存任何交易。</span>
        </div>
        <div className="overview-region">
          <section className="summary-grid" aria-label="展示月份摘要">
            <article className="summary-card summary-balance"><span>本月結餘</span><strong>HK$51,415.60</strong></article>
            <article className="summary-card summary-income"><span>本月收入</span><strong>HK$52,000.00</strong></article>
            <article className="summary-card summary-expense"><span>本月支出</span><strong>HK$584.40</strong></article>
          </section>
        </div>
        <section className="transactions-panel" aria-labelledby="offline-transactions-title">
          <div className="transactions-heading"><div><h2 id="offline-transactions-title">展示交易</h2><p>只儲存在離線應用外殼</p></div></div>
          <ul className="transaction-list" aria-label="展示交易清單">
            {demoTransactions.map(({ id, Icon, title, detail, date, amount, type }) => (
              <li className="transaction-row" key={id}>
                <span className="category-icon" aria-hidden="true"><Icon /></span>
                <span className="transaction-main"><strong>{title}</strong><small>{detail}</small></span>
                <time dateTime={`2026-07-${id === 1 ? '11' : id === 2 ? '08' : '01'}`}>{date}</time>
                <strong className={`transaction-amount ${type}`}>
                  <span className="sr-only">{type === 'income' ? '收入' : '支出'}</span>
                  {amount}
                </strong>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}
