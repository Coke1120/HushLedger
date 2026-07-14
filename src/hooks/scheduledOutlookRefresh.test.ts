import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  scheduledOutlookRefreshMaxAttempts,
  scheduledOutlookRefreshRetryDelayMs,
  startScheduledOutlookRefreshRetries,
} from './scheduledOutlookRefresh'

async function settleAsyncWork() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('scheduled outlook refresh retries', () => {
  it('bounds failed Hong Kong day refreshes and leaves later recovery to foreground or online events', async () => {
    let refreshCount = 0
    const scheduledCallbacks: Array<() => void> = []
    const scheduledDelays: number[] = []

    startScheduledOutlookRefreshRetries(
      async () => {
        refreshCount += 1
        return false
      },
      {
        schedule: (callback, delayMs) => {
          scheduledCallbacks.push(callback)
          scheduledDelays.push(delayMs)
          return refreshCount
        },
        cancel: () => undefined,
      },
    )

    await settleAsyncWork()
    assert.equal(refreshCount, 1)

    while (scheduledCallbacks.length > 0) {
      scheduledCallbacks.shift()!()
      await settleAsyncWork()
    }

    assert.equal(refreshCount, scheduledOutlookRefreshMaxAttempts)
    assert.deepEqual(
      scheduledDelays,
      Array.from(
        { length: scheduledOutlookRefreshMaxAttempts - 1 },
        () => scheduledOutlookRefreshRetryDelayMs,
      ),
    )
  })

  it('stops retrying as soon as a refresh succeeds', async () => {
    let refreshCount = 0
    const scheduledCallbacks: Array<() => void> = []
    startScheduledOutlookRefreshRetries(
      async () => {
        refreshCount += 1
        return refreshCount === 2
      },
      {
        schedule: (callback) => {
          scheduledCallbacks.push(callback)
          return refreshCount
        },
        cancel: () => undefined,
      },
    )

    await settleAsyncWork()
    assert.equal(scheduledCallbacks.length, 1)
    scheduledCallbacks.shift()!()
    await settleAsyncWork()

    assert.equal(refreshCount, 2)
    assert.equal(scheduledCallbacks.length, 0)
  })

  it('does not schedule a retry after the stale view is cancelled during a request', async () => {
    const refreshResolvers: Array<(refreshed: boolean) => void> = []
    let scheduled = false
    const cancel = startScheduledOutlookRefreshRetries(
      () => new Promise<boolean>((resolve) => { refreshResolvers.push(resolve) }),
      {
        schedule: () => {
          scheduled = true
          return 1
        },
        cancel: () => undefined,
      },
    )

    await settleAsyncWork()
    cancel()
    assert.equal(refreshResolvers.length, 1)
    refreshResolvers[0](false)
    await settleAsyncWork()

    assert.equal(scheduled, false)
  })
})
