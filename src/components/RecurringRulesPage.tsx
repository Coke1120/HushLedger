import {
  CalendarCheck,
  CalendarClock,
  CircleAlert,
  CloudOff,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useRecurringRules } from '../hooks/useRecurringRules'
import { formatHongKongDate } from '../lib/date'
import { formatMoney } from '../lib/money'
import type {
  Account,
  Category,
  RecurrenceFrequency,
  RecurringRule,
  RecurringRuleCreateInput,
  RecurringRuleUpdateInput,
} from '../lib/schema'
import { RecurringDeleteDialog } from './RecurringDeleteDialog'
import { RecurringRuleDialog } from './RecurringRuleDialog'

type RecurringRulesPageProps = {
  accounts: Account[]
  categories: Category[]
  onMoneyRefresh: () => Promise<boolean>
}

const frequencyLabels: Record<RecurrenceFrequency, string> = {
  daily: '每日',
  weekly: '每週',
  monthly: '每月',
}

export function RecurringRulesPage({ accounts, categories, onMoneyRefresh }: RecurringRulesPageProps) {
  const recurring = useRecurringRules(onMoneyRefresh)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null)
  const [deletingRule, setDeletingRule] = useState<RecurringRule | null>(null)

  const accountNames = useMemo(() => new Map(accounts.map((account) => [account.id, account.name])), [accounts])
  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories])

  const closeEditor = useCallback(() => {
    setEditorOpen(false)
    setEditingRule(null)
  }, [])
  const closeDelete = useCallback(() => setDeletingRule(null), [])

  const openCreate = () => {
    recurring.clearActionMessage()
    setEditingRule(null)
    setEditorOpen(true)
  }

  const openEdit = (rule: RecurringRule) => {
    recurring.clearActionMessage()
    setEditingRule(rule)
    setEditorOpen(true)
  }

  const createRule = useCallback(
    (input: RecurringRuleCreateInput) => recurring.createRule(input),
    [recurring],
  )
  const editRule = useCallback(
    (id: string, input: RecurringRuleUpdateInput) => recurring.editRule(id, input),
    [recurring],
  )

  const statusContent = (() => {
    if (!recurring.online) {
      return {
        className: 'recurring-status status-warning',
        icon: <CloudOff aria-hidden="true" />,
        text: '目前離線：可查看示範設定，但不能建立、修改、暫停或刪除。',
      }
    }
    if (recurring.source === 'loading') {
      return {
        className: 'recurring-status',
        icon: <LoaderCircle className="spin" aria-hidden="true" />,
        text: '正在載入週期交易…',
      }
    }
    if (recurring.source === 'error' || recurring.error) {
      return {
        className: 'recurring-status status-error',
        icon: <CircleAlert aria-hidden="true" />,
        text: recurring.error || '未能載入週期交易。',
      }
    }
    if (recurring.actionMessage) {
      return {
        className: 'recurring-status status-success',
        icon: <CalendarCheck aria-hidden="true" />,
        text: recurring.actionMessage,
      }
    }
    if (recurring.source === 'demo') {
      return {
        className: 'recurring-status status-warning',
        icon: <Sparkles aria-hidden="true" />,
        text: '現正顯示示範資料；變更只保留在本次頁面，不會寫入 Cloudflare。',
      }
    }
    return null
  })()

  const loading = recurring.source === 'loading'

  return (
    <section className="recurring-page" aria-labelledby="recurring-page-title">
      <div className="recurring-hero">
        <div className="recurring-hero-copy">
          <h2 id="recurring-page-title">週期交易</h2>
          <p>設定每日、每週或每月自動建立收入與支出。只需選日期，不需要填寫時間。</p>
        </div>
        <div className="recurring-hero-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void recurring.runDue()}
            disabled={!recurring.online || recurring.running || loading}
          >
            {recurring.running ? <LoaderCircle className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {recurring.running ? '正在檢查…' : '產生到期交易'}
          </button>
          <button className="button button-primary" type="button" onClick={openCreate} disabled={!recurring.online}>
            <Plus aria-hidden="true" />
            新增週期交易
          </button>
        </div>
      </div>

      {statusContent ? (
        <div className={statusContent.className} role={recurring.error ? 'alert' : 'status'}>
          {statusContent.icon}
          <span>{statusContent.text}</span>
          {recurring.source === 'error' ? (
            <button type="button" onClick={() => void recurring.refresh()}>
              <RefreshCw aria-hidden="true" />
              重試
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="recurring-panel">
        <div className="recurring-panel-heading">
          <div>
            <h3>你的自動設定</h3>
            <p>{loading ? '正在載入' : `${recurring.rules.length} 項設定`}</p>
          </div>
          <span className="date-only-note">
            <CalendarClock aria-hidden="true" />
            日期制，不記錄時間
          </span>
        </div>

        {loading ? (
          <div className="recurring-empty" role="status">
            <LoaderCircle className="spin" aria-hidden="true" />
            正在整理週期交易…
          </div>
        ) : recurring.rules.length === 0 ? (
          <div className="recurring-empty">
            <span className="recurring-empty-icon" aria-hidden="true">
              <Repeat />
            </span>
            <strong>尚未建立週期交易</strong>
            <span>可先加入租金、薪金或日常固定支出。</span>
            <button className="button button-primary" type="button" onClick={openCreate} disabled={!recurring.online}>
              <Plus aria-hidden="true" />
              建立第一項設定
            </button>
          </div>
        ) : (
          <ul className="recurring-list" aria-label="週期交易設定">
            {recurring.rules.map((rule) => {
              const busy = recurring.mutatingId === rule.id
              const accountName = accountNames.get(rule.accountId) ?? '未知帳戶'
              const categoryName = categoryNames.get(rule.categoryId) ?? '未知分類'
              return (
                <li className={`recurring-rule ${rule.isActive ? '' : 'is-paused'}`} key={rule.id}>
                  <div className="recurring-rule-main">
                    <span className={`recurring-rule-icon ${rule.type}`} aria-hidden="true">
                      <Repeat />
                    </span>
                    <div className="recurring-rule-title">
                      <span className={`rule-status ${rule.isActive ? 'is-active' : 'is-paused'}`}>
                        {rule.isActive ? '運作中' : '已暫停'}
                      </span>
                      <strong>{rule.name}</strong>
                      <small>{rule.payee || `${categoryName} · ${accountName}`}</small>
                    </div>
                  </div>

                  <div className="recurring-rule-amount">
                    <span>每次</span>
                    <strong className={rule.type}>
                      <span className="sr-only">{rule.type === 'income' ? '收入' : '支出'}</span>
                      {rule.type === 'income' ? '+' : '−'}
                      {formatMoney(rule.amountMinor)}
                    </strong>
                  </div>

                  <dl className="recurring-rule-details">
                    <div>
                      <dt>頻率</dt>
                      <dd>{frequencyLabels[rule.frequency]}</dd>
                    </div>
                    <div>
                      <dt>下次日期</dt>
                      <dd>{formatHongKongDate(rule.nextOccurrenceOn)}</dd>
                    </div>
                    <div>
                      <dt>帳戶／分類</dt>
                      <dd>
                        {accountName} · {categoryName}
                      </dd>
                    </div>
                    <div>
                      <dt>已產生</dt>
                      <dd>{rule.generatedCount} 筆</dd>
                    </div>
                  </dl>

                  {rule.lastErrorCode ? (
                    <p className="rule-error" role="status">
                      <CircleAlert aria-hidden="true" />
                      上次產生未完成，請檢查帳戶及分類後重試。
                    </p>
                  ) : null}

                  <div className="recurring-rule-actions">
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => openEdit(rule)}
                      disabled={!recurring.online || busy}
                    >
                      <Pencil aria-hidden="true" />
                      修改
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => void recurring.setRuleActive(rule, !rule.isActive)}
                      disabled={!recurring.online || busy}
                    >
                      {busy ? (
                        <LoaderCircle className="spin" aria-hidden="true" />
                      ) : rule.isActive ? (
                        <Pause aria-hidden="true" />
                      ) : (
                        <Play aria-hidden="true" />
                      )}
                      {rule.isActive ? '暫停' : '恢復'}
                    </button>
                    <button
                      className="button recurring-delete-button"
                      type="button"
                      onClick={() => setDeletingRule(rule)}
                      disabled={!recurring.online || busy}
                    >
                      <Trash2 aria-hidden="true" />
                      刪除
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {editorOpen ? (
        <RecurringRuleDialog
          rule={editingRule}
          accounts={accounts}
          categories={categories}
          saving={recurring.mutatingId === (editingRule?.id ?? 'new')}
          serverError={recurring.error}
          online={recurring.online}
          onClose={closeEditor}
          onCreate={createRule}
          onEdit={editRule}
        />
      ) : null}

      {deletingRule ? (
        <RecurringDeleteDialog
          rule={deletingRule}
          deleting={recurring.mutatingId === deletingRule.id}
          onClose={closeDelete}
          onConfirm={() => recurring.deleteRule(deletingRule)}
        />
      ) : null}
    </section>
  )
}
