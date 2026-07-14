import { ArrowRightLeft, Plus } from 'lucide-react'
import { useI18n } from '../i18n'
import type { AccountTransfer } from '../lib/schema'

type AccountTransferListProps = {
  transfers: AccountTransfer[]
  loading: boolean
  available: boolean
  onAdd: () => void
  onEdit: (transfer: AccountTransfer) => void
}

export function AccountTransferList({
  transfers,
  loading,
  available,
  onAdd,
  onEdit,
}: AccountTransferListProps) {
  const { formatDate, formatMoney, localizeEntityName, t } = useI18n()

  return (
    <section className="account-transfers" aria-labelledby="account-transfers-title">
      <div className="account-transfers-heading">
        <div>
          <h3 id="account-transfers-title"><ArrowRightLeft aria-hidden="true" />{t('accountTransfersTitle')}</h3>
          <p>{loading
            ? t('organizingTransactions')
            : t(transfers.length === 1 ? 'transferCountOne' : 'transferCount', { count: transfers.length })}
          </p>
        </div>
        <button className="button button-secondary" type="button" onClick={onAdd} disabled={!available} title={!available ? t('transferUnavailable') : undefined}>
          <Plus aria-hidden="true" />
          {t('recordTransfer')}
        </button>
      </div>
      {loading ? (
        <div className="account-transfers-empty" role="status">{t('organizingTransactions')}</div>
      ) : transfers.length === 0 ? (
        <div className="account-transfers-empty">
          <strong>{t('noTransfers')}</strong>
          <span>{t('noTransfersHelp')}</span>
        </div>
      ) : (
        <ul className="account-transfer-list" aria-label={t('transferList')}>
          {transfers.map((transfer) => {
            const source = localizeEntityName(transfer.fromAccountName, transfer.fromAccountLocalizationKey)
            const destination = localizeEntityName(transfer.toAccountName, transfer.toAccountLocalizationKey)
            return (
              <li key={transfer.id}>
                <button type="button" className="account-transfer-row" onClick={() => onEdit(transfer)}>
                  <span className="transfer-icon" aria-hidden="true"><ArrowRightLeft /></span>
                  <span className="account-transfer-main">
                    <strong>{t('transferDirection', { from: source, to: destination })}</strong>
                    <small>
                      <span className={transfer.fromCleared ? 'is-cleared' : undefined}>{t('transferSourceStatus', { status: t(transfer.fromCleared ? 'cleared' : 'uncleared') })}</span>
                      <span className={transfer.toCleared ? 'is-cleared' : undefined}>{t('transferDestinationStatus', { status: t(transfer.toCleared ? 'cleared' : 'uncleared') })}</span>
                      {transfer.recurringTransferRuleName ? (
                        <span className="recurring-transfer-badge">
                          {t('recurringTransferBadge', { name: transfer.recurringTransferRuleName })}
                        </span>
                      ) : null}
                    </small>
                    {transfer.note ? <span className="account-transfer-note">{transfer.note}</span> : null}
                  </span>
                  <time dateTime={transfer.occurredOn}>{formatDate(transfer.occurredOn)}</time>
                  <strong className="account-transfer-amount">
                    {formatMoney(transfer.amountMinor, transfer.currency)}
                  </strong>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {transfers.length === 200 ? <p className="account-transfers-limit">{t('transferLimit')}</p> : null}
    </section>
  )
}
