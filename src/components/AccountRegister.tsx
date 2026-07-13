import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Landmark, ReceiptText } from 'lucide-react'
import { useMemo } from 'react'
import { useI18n } from '../i18n'
import type { AccountRegister as AccountRegisterData, AccountTransfer, Transaction } from '../lib/schema'

type AccountRegisterProps = {
  register: AccountRegisterData | null
  transactions: Transaction[]
  transfers: AccountTransfer[]
  loading: boolean
  onClose: () => void
  onEditTransaction: (transaction: Transaction) => void
  onEditTransfer: (transfer: AccountTransfer) => void
}

export function AccountRegister({
  register,
  transactions,
  transfers,
  loading,
  onClose,
  onEditTransaction,
  onEditTransfer,
}: AccountRegisterProps) {
  const { formatDate, formatMoney, formatMonth, localizeEntityName, t } = useI18n()
  const transactionsById = useMemo(
    () => new Map(transactions.map((transaction) => [transaction.id, transaction])),
    [transactions],
  )
  const transfersById = useMemo(
    () => new Map(transfers.map((transfer) => [transfer.id, transfer])),
    [transfers],
  )

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
                  <small>
                    {entry.kind === 'transaction' ? <span>{categoryName}</span> : null}
                    {entry.cleared !== null ? (
                      <span className={entry.cleared ? 'is-cleared' : undefined}>
                        {t(entry.cleared ? 'cleared' : 'uncleared')}
                      </span>
                    ) : null}
                  </small>
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
                  <button
                    className="account-register-row"
                    type="button"
                    onClick={() => transaction
                      ? onEditTransaction(transaction)
                      : transfer && onEditTransfer(transfer)}
                  >
                    <span className="sr-only">{t('edit')}</span>
                    {content}
                  </button>
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
