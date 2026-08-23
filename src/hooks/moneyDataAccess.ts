export type DataSource = 'loading' | 'live' | 'demo' | 'error'
export type RefreshFailureMode = 'demo' | 'error' | 'preserve'

export function sourceAfterMoneyRefreshFailure(
  online: boolean,
  failureMode: RefreshFailureMode,
  demoFallbackAllowed: boolean,
): DataSource | null {
  if (online || !demoFallbackAllowed) return 'error'
  return failureMode === 'demo' ? 'demo' : null
}

export function moneyMutationSource(
  source: DataSource,
  online: boolean,
  writableSource: 'live' | 'demo' | null,
): 'live' | 'demo' | null {
  if (!online || source !== writableSource) return null
  return source === 'live' || source === 'demo' ? source : null
}
