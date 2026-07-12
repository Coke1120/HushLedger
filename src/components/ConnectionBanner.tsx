import { AlertTriangle, CheckCircle2, CloudOff, LoaderCircle, RefreshCw } from 'lucide-react'
import type { DataSource } from '../hooks/useMoneyData'
import { useI18n } from '../i18n'

type ConnectionBannerProps = {
  source: DataSource
  online: boolean
  actionMessage: string
  onRetry: () => void
}

export function ConnectionBanner({ source, online, actionMessage, onRetry }: ConnectionBannerProps) {
  const { t } = useI18n()

  if (actionMessage) {
    return (
      <div className="status-banner status-success" role="status">
        <CheckCircle2 aria-hidden="true" />
        <span>{actionMessage}</span>
      </div>
    )
  }

  if (source === 'loading') {
    return (
      <div className="status-banner status-loading" role="status">
        <LoaderCircle className="spin" aria-hidden="true" />
        <span>{t('loadingMoneyData')}</span>
      </div>
    )
  }

  if (!online) {
    return (
      <div className="status-banner status-warning" role="alert">
        <CloudOff aria-hidden="true" />
        <span>{t('offlineMoneyData')}</span>
      </div>
    )
  }

  if (source === 'demo') {
    return (
      <div className="status-banner status-warning" role="alert">
        <AlertTriangle aria-hidden="true" />
        <span>
          <strong>{t('demoMode')}</strong> {t('demoMoneyData')}
        </span>
        <button type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          {t('retry')}
        </button>
      </div>
    )
  }

  if (source === 'error') {
    return (
      <div className="status-banner status-error" role="alert">
        <AlertTriangle aria-hidden="true" />
        <span>{t('savedRefreshFailed')}</span>
        <button type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          {t('refresh')}
        </button>
      </div>
    )
  }

  return null
}
