import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Circle,
  CircleCheck,
  Landmark,
  LoaderCircle,
  ReceiptText,
  Scale,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import { parseSignedAmount } from '../lib/money'
import { calculateReconciliationDifference } from '../lib/reconciliation'
import type {
  AccountBalance,
  AccountRegister as AccountRegisterData,
  AccountTransfer,
  Transaction,
} from '../lib/schema'

type AccountRegisterProps = {
  register: AccountRegisterData | null
  balance: AccountBalance | null
  transactions: Transaction[]
  transfers: AccountTransfer[]
  loading: boolean
  saving: boolean
  reconcileInitially: boolean
  onClose: () => void
  onEditTransaction: (transaction: Transaction) => void
  onEditTransfer: (transfer: AccountTransfer) => void
  onSetTransactionCleared: (transaction: Transaction, cleared: boolean) => Promise<boolean>
  onSetTransferCleared: (
    transfer: AccountTransfer,
    accountId: number,
    cleared: boolean,
  ) => Promise<boolean>
}

export function AccountRegister({
  register,
  balance,
  transactions,
  transfers,
  loading,
  saving,
  reconcileInitially,
  onClose,
  onEditTransaction,
  onEditTransfer,
  onSetTransactionCleared,
  onSetTransferCleared,
}: AccountRegisterProps) {
  const { formatDate, formatMoney, formatMonth, locale, localizeEntityName, privacyMode, t } = useI18n()
  const [reconciling, setReconciling] = useState(reconcileInitially)
  const [statementValue, setStatementValue] = useState('')
  const [updatingEntryId, setUpdatingEntryId] = useState<string | null>(null)
  const transactionsById = useMemo(
    () => new Map(transactions.map((transaction) => [transaction.id, transaction])),
    [transactions],
  )
  const transfersById = useMemo(
    () => new Map(transfers.map((transfer) => [transfer.id, transfer])),
    [transfers],
  )
  const clearedBalance = balance?.clearedBalance
  const statementResult = useMemo(() => {
    if (!statementValue.trim()) return null
    if (clearedBalance === null || clearedBalance === undefined) return null
    try {
      return calculateReconciliationDifference(
        parseSignedAmount(statementValue, locale),
        clearedBalance,
      )
    } catch {
      return undefined
    }
  }, [clearedBalance, locale, statementValue])

  if (loading || !register) {
    return (
      <section className="account-register" aria-busy="true">
        <button className="button button-secondary account-register-back" type="button" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
          {t('backToTransactions')}
        </button>
        <p className="account-register-empty" role="status">
          {t(loading ? 'accountRegisterLoading' : 'demoMoneyData')}
        </p>
      </section>
    )
  }

  const accountName = localizeEntityName(register.accountName, register.accountLocalizationKey)
  const setEntryCleared = async (
    entryId: string,
    cleared: boolean,
    transaction?: Transaction,
    transfer?: AccountTransfer,
  ) => {
    if (saving || updatingEntryId !== null) return
    setUpdatingEntryId(entryId)
    try {
      if (transaction) await onSetTransactionCleared(transaction, cleared)
      else if (transfer) await onSetTransferCleared(transfer, register.accountId, cleared)
    } finally {
      setUpdatingEntryId(null)
    }
  }

  return (
    <section className="account-register" aria-labelledby="account-register-title">
      <button className="button button-secondary account-register-back" type="button" onClick={onClose}>
        <ArrowLeft aria-hidden="true" />
        {t('backToTransactions')}
      </button>

      <header className="account-register-heading">
        <span aria-hidden="true"><Landmark /></span>
        <div>
          <h2 id="account-register-title">{t('accountRegisterTitle', { account: accountName })}</h2>
          <p>{t('accountRegisterHelp', { month: formatMonth(register.month) })}</p>
        </div>
        <button
          className="button button-secondary account-register-reconcile-toggle"
          type="button"
          onClick={() => setReconciling((current) => !current)}
          disabled={balance?.clearedBalance === null || balance?.clearedBalance === undefined}
          aria-expanded={reconciling}
          aria-controls="account-reconciliation"
        >
          <Scale aria-hidden="true" />
          {t(reconciling ? 'closeStatementComparison' : 'compareStatement')}
        </button>
      </header>

      <dl className="account-register-summary">
        <div>
          <dt>{t('accountRegisterStartingBalance')}</dt>
          <dd>{register.startingBalanceMinor === null
            ? t('accountRegisterUnavailable')
            : formatMoney(register.startingBalanceMinor)}
          </dd>
        </div>
        <div>
          <dt>{t('accountRegisterEndingBalance')}</dt>
          <dd>{register.endingBalanceMinor === null
            ? t('accountRegisterUnavailable')
            : formatMoney(register.endingBalanceMinor)}
          </dd>
        </div>
        <div>
          <dt>{t('accountRegisterEntries')}</dt>
          <dd>{register.entryCount}</dd>
        </div>
      </dl>

      {reconciling && balance?.clearedBalance !== null && balance?.clearedBalance !== undefined ? (
        <section className="account-reconciliation" id="account-reconciliation" aria-labelledby="account-reconciliation-title">
          <header>
            <div>
              <h3 id="account-reconciliation-title">{t('reconciliationTitle')}</h3>
              <p>{t('reconciliationHelp')}</p>
            </div>
            <span>{t('reconciliationLocalOnly')}</span>
          </header>
          <dl className="account-reconciliation-balances">
            <div>
              <dt>{t('recordedBalance')}</dt>
              <dd>{formatMoney(balance.recordedBalance ?? 0)}</dd>
            </div>
            <div>
              <dt>{t('clearedBalance')}</dt>
              <dd>{formatMoney(balance.clearedBalance)}</dd>
            </div>
            <div>
              <dt>{t('unclearedBalance')}</dt>
              <dd>{formatMoney(balance.unclearedBalance ?? 0)}</dd>
            </div>
          </dl>
          <div className="statement-comparison">
            <label>
              <span>{t('statementEndingBalance')}</span>
              <input
                type={privacyMode ? 'password' : 'text'}
                inputMode="decimal"
                value={statementValue}
                onChange={(event) => setStatementValue(event.target.value)}
                placeholder={t('statementBalancePlaceholder')}
                autoComplete="off"
                autoFocus
              />
            </label>
            <div className="statement-comparison-result" aria-live="polite">
              {statementResult === undefined ? (
                <span className="is-error">{t('invalidStatementBalance')}</span>
              ) : statementResult === null ? (
                <span>{t('statementComparisonHelp')}</span>
              ) : statementResult === 0 ? (
                <strong className="is-match">{t('statementBalancesMatch')}</strong>
              ) : (
                <strong>{t('statementDifference', { amount: formatMoney(statementResult) })}</strong>
              )}
            </div>
          </div>
          <p className="account-reconciliation-review">
            {t('reconciliationReviewHelp', {
              count: register.entries.filter(({ cleared }) => cleared === false).length,
            })}
          </p>
        </section>
      ) : null}

      {register.availableFrom ? (
        <p className="account-register-boundary">
          {t('accountRegisterAvailableFrom', { date: formatDate(register.availableFrom) })}
        </p>
      ) : null}

      {register.entries.length === 0 ? (
        <div className="account-register-empty">
          <strong>{t('accountRegisterEmpty')}</strong>
          <span>{t('accountRegisterEmptyHelp')}</span>
        </div>
      ) : (
        <ul className="account-register-list" aria-label={t('accountRegisterList')}>
          {register.entries.map((entry) => {
            const transaction = entry.kind === 'transaction' && entry.sourceId
              ? transactionsById.get(entry.sourceId)
              : undefined
            const transfer = entry.kind === 'transfer' && entry.sourceId
              ? transfersById.get(entry.sourceId)
              : undefined
            const categoryName = entry.categoryName
              ? localizeEntityName(entry.categoryName, entry.categoryLocalizationKey)
              : ''
            const counterparty = entry.counterpartyAccountName
              ? localizeEntityName(
                  entry.counterpartyAccountName,
                  entry.counterpartyAccountLocalizationKey,
                )
              : ''
            const title = entry.kind === 'opening'
              ? t('accountRegisterOpeningBalance')
              : entry.kind === 'transfer'
                ? t(entry.transferDirection === 'in' ? 'accountRegisterTransferIn' : 'accountRegisterTransferOut', {
                    account: counterparty,
                  })
                : entry.payee || categoryName
            const editable = Boolean(transaction || transfer)
            const amountSign = entry.amountMinor > 0 ? '+' : entry.amountMinor < 0 ? '−' : ''
            const Icon = entry.kind === 'opening'
              ? Landmark
              : entry.transferDirection === 'in'
                ? ArrowDownLeft
                : entry.transferDirection === 'out'
                  ? ArrowUpRight
                  : ReceiptText

            const content = (
              <>
                <span className={`account-register-icon ${entry.kind}`} aria-hidden="true"><Icon /></span>
                <span className="account-register-main">
                  <strong>{title}</strong>
                  {entry.kind === 'transaction' ? <small><span>{categoryName}</span></small> : null}
                  {entry.note ? <span className="account-register-note">{entry.note}</span> : null}
                </span>
                <time dateTime={entry.occurredOn}>{formatDate(entry.occurredOn)}</time>
                <span className="account-register-money">
                  <strong className={entry.amountMinor >= 0 ? 'income' : 'expense'}>
                    {amountSign}{formatMoney(Math.abs(entry.amountMinor))}
                  </strong>
                  <small>{t('accountRegisterRunningBalance', {
                    amount: formatMoney(entry.runningBalanceMinor),
                  })}</small>
                </span>
              </>
            )

            return (
              <li key={entry.entryId}>
                {editable ? (
                  <>
                    <button
                      className={`account-register-row${entry.cleared === false ? ' is-uncleared' : ''}`}
                      type="button"
                      disabled={saving}
                      onClick={() => transaction
                        ? onEditTransaction(transaction)
                        : transfer && onEditTransfer(transfer)}
                    >
                      <span className="sr-only">{t('edit')}</span>
                      {content}
                    </button>
                    {entry.cleared !== null ? (
                      <button
                        className={`account-register-clearing-toggle ${entry.cleared ? 'is-cleared' : 'is-uncleared'}`}
                        type="button"
                        disabled={saving}
                        aria-busy={updatingEntryId === entry.entryId}
                        aria-label={t(entry.cleared
                          ? 'markRegisterEntryUncleared'
                          : 'markRegisterEntryCleared')}
                        title={t(entry.cleared
                          ? 'markRegisterEntryUncleared'
                          : 'markRegisterEntryCleared')}
                        onClick={() => void setEntryCleared(
                          entry.entryId,
                          !entry.cleared,
                          transaction,
                          transfer,
                        )}
                      >
                        {updatingEntryId === entry.entryId
                          ? <LoaderCircle className="spin" aria-hidden="true" />
                          : entry.cleared
                            ? <CircleCheck aria-hidden="true" />
                            : <Circle aria-hidden="true" />}
                        <span>{t(entry.cleared ? 'cleared' : 'uncleared')}</span>
                      </button>
                    ) : null}
                  </>
                ) : (
                  <div className="account-register-row">{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {register.entryCount > register.entries.length ? (
        <p className="account-register-limit">
          {t('accountRegisterLimit', {
            shown: register.entries.length,
            total: register.entryCount,
          })}
        </p>
      ) : null}
    </section>
  )
}
