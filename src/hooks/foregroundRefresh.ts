type VisibilitySource = {
  readonly visibilityState: DocumentVisibilityState
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export function subscribeToForegroundRefresh(
  source: VisibilitySource,
  isBlocked: () => boolean,
  refresh: () => void,
) {
  let wasHidden = source.visibilityState === 'hidden'

  const handleVisibilityChange = () => {
    if (source.visibilityState === 'hidden') {
      wasHidden = true
      return
    }
    if (!wasHidden) return
    wasHidden = false
    if (!isBlocked()) refresh()
  }

  source.addEventListener('visibilitychange', handleVisibilityChange)
  return () => source.removeEventListener('visibilitychange', handleVisibilityChange)
}
