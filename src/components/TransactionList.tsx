import {
  Banknote,
  CircleDollarSign,
  CircleEllipsis,
  Gamepad2,
  HeartPulse,
  House,
  ReceiptText,
  Repeat,
  ShoppingBag,
  Train,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import { formatHongKongDate } from '../lib/date'
import { formatMoney } from '../lib/money'
import type { Transaction } from '../lib/schema'

const iconMap: Record<string, LucideIcon> = {
  banknote: Banknote,
  'circle-dollar-sign': CircleDollarSign,
  utensils: Utensils,
  train: Train,
  'shopping-bag': ShoppingBag,
  house: House,
  'receipt-text': ReceiptText,
  'gamepad-2': Gamepad2,
  'heart-pulse': HeartPulse,
  'circle-ellipsis': CircleEllipsis,
}

type TransactionListProps = {
  transactions: Transaction[]
  loading: boolean
}

export function TransactionList({ transactions, loading }: TransactionListProps) {
  if (loading) {
    return (
      <div className="transaction-empty" role="status">
        正在整理交易紀錄…
      </div>
    )
  }

  if (transactions.length === 0) {
    return (
      <div className="transaction-empty">
        <strong>找不到交易</strong>
        <span>可調整月份、類型或搜尋字詞。</span>
      </div>
    )
  }

  return (
    <ul className="transaction-list" aria-label="交易紀錄">
      {transactions.map((transaction) => {
        const Icon = iconMap[transaction.categoryIcon] ?? CircleEllipsis
        const title = transaction.payee || transaction.categoryName
        return (
          <li className="transaction-row" key={transaction.id}>
            <span
              className="category-icon"
              style={{ color: transaction.categoryColor, backgroundColor: `${transaction.categoryColor}18` }}
              aria-hidden="true"
            >
              <Icon />
            </span>
            <span className="transaction-main">
              <strong className="transaction-title">
                <span>{title}</span>
                {transaction.recurringRuleId ? (
                  <span className="auto-generated-badge" title={`由週期交易「${transaction.recurringRuleName ?? '未命名'}」自動產生`}>
                    <Repeat aria-hidden="true" />
                    <span className="sr-only">
                      由週期交易「{transaction.recurringRuleName ?? '未命名'}」自動產生
                    </span>
                  </span>
                ) : null}
              </strong>
              <small>
                {transaction.categoryName} · {transaction.accountName}
              </small>
            </span>
            <time dateTime={transaction.occurredOn}>{formatHongKongDate(transaction.occurredOn)}</time>
            <strong className={`transaction-amount ${transaction.type}`}>
              <span className="sr-only">{transaction.type === 'income' ? '收入' : '支出'}</span>
              {transaction.type === 'income' ? '+' : '−'}
              {formatMoney(transaction.amountMinor)}
            </strong>
          </li>
        )
      })}
    </ul>
  )
}
