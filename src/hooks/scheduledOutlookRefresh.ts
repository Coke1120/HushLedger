export const scheduledOutlookRefreshRetryDelayMs = 60_000
export const scheduledOutlookRefreshMaxAttempts = 3

type RetryScheduler = {
  schedule: (callback: () => void, delayMs: number) => number
  cancel: (timer: number) => void
}

const browserRetryScheduler: RetryScheduler = {
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (timer) => window.clearTimeout(timer),
}

export function startScheduledOutlookRefreshRetries(
  refresh: () => Promise<boolean>,
  scheduler: RetryScheduler = browserRetryScheduler,
) {
  let cancelled = false
  let retryTimer: number | null = null
  let attempts = 0

  const run = async () => {
    attempts += 1
    let refreshed = false
    try {
      refreshed = await refresh()
    } catch {
      // A bounded retry remains the recovery path for unexpected failures.
    }
    if (cancelled || refreshed || attempts >= scheduledOutlookRefreshMaxAttempts) return
    retryTimer = scheduler.schedule(() => {
      retryTimer = null
      void run()
    }, scheduledOutlookRefreshRetryDelayMs)
  }

  void run()

  return () => {
    cancelled = true
    if (retryTimer !== null) scheduler.cancel(retryTimer)
  }
}
