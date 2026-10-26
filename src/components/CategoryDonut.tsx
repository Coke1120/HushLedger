import { ChartPie, EyeOff } from 'lucide-react'
import { useI18n } from '../i18n'
import { categoryComposition, type CompositionItem } from '../lib/categoryComposition'

type CategoryDonutProps = {
  items: readonly CompositionItem[]
  total: number
  label: string
}

export function CategoryDonut({ items, total, label }: CategoryDonutProps) {
  const { formatMoney, privacyMode, t } = useI18n()
  const composition = categoryComposition(items, total)
  if (composition.state === 'unavailable') {
    return <p className="composition-unavailable" role="status">{t('compositionUnavailable')}</p>
  }
  return (
    <div className="composition-donut" data-state={privacyMode ? 'private' : composition.state}>
      <svg viewBox="0 0 220 220" aria-hidden="true" focusable="false">
        <circle className="composition-track" cx="110" cy="110" r="86" fill="none" strokeWidth="24" />
        {!privacyMode ? composition.segments.map((segment) => (
          <circle
            key={segment.key}
            className="composition-segment"
            cx="110"
            cy="110"
            r="86"
            pathLength="100"
            fill="none"
            stroke={segment.color}
            strokeWidth="24"
            strokeDasharray={segment.share + ' ' + (100 - segment.share)}
            strokeDashoffset={-segment.offset}
            transform="rotate(-90 110 110)"
          />
        )) : null}
        {!privacyMode && composition.segments.length > 1 ? composition.segments.map((segment) => {
          const angle = segment.offset / 100 * Math.PI * 2 - Math.PI / 2
          return <line
            key={'divider-' + segment.key}
            className="composition-divider"
            x1={110 + 74 * Math.cos(angle)} y1={110 + 74 * Math.sin(angle)}
            x2={110 + 98 * Math.cos(angle)} y2={110 + 98 * Math.sin(angle)}
            stroke="var(--surface)" strokeWidth="1.5"
          />
        }) : null}
      </svg>
      <div className="composition-center">
        {privacyMode ? <EyeOff aria-hidden="true" /> : <ChartPie aria-hidden="true" />}
        <span>{label}</span>
        <strong>{formatMoney(total)}</strong>
        <small>{privacyMode ? t('sensitiveTextHidden') : t('compositionCategories', { count: composition.segments.length })}</small>
      </div>
    </div>
  )
}
