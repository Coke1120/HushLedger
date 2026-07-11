import { AlertTriangle, CheckCircle2, CloudOff, LoaderCircle, RefreshCw } from 'lucide-react'
import type { DataSource } from '../hooks/useMoneyData'

type ConnectionBannerProps = {
  source: DataSource
  online: boolean
  actionMessage: string
  onRetry: () => void
}

export function ConnectionBanner({ source, online, actionMessage, onRetry }: ConnectionBannerProps) {
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
        <span>正在載入你的收支資料…</span>
      </div>
    )
  }

  if (!online) {
    return (
      <div className="status-banner status-warning" role="alert">
        <CloudOff aria-hidden="true" />
        <span>目前離線。只可查看展示資料，離線時不會儲存交易。</span>
      </div>
    )
  }

  if (source === 'demo') {
    return (
      <div className="status-banner status-warning" role="alert">
        <AlertTriangle aria-hidden="true" />
        <span>
          <strong>展示模式：</strong> API 暫時無法連線；新增資料只保留在本次頁面，不會儲存到 Cloudflare。
        </span>
        <button type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          重試
        </button>
      </div>
    )
  }

  if (source === 'error') {
    return (
      <div className="status-banner status-error" role="alert">
        <AlertTriangle aria-hidden="true" />
        <span>資料已儲存，但畫面未能重新整理。</span>
        <button type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          重新整理
        </button>
      </div>
    )
  }

  return null
}
