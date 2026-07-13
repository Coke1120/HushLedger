import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { subscribeToForegroundRefresh } from './foregroundRefresh'

class FakeVisibilitySource {
  private listeners = new Set<() => void>()

  constructor(public visibilityState: DocumentVisibilityState) {}

  addEventListener(_type: 'visibilitychange', listener: () => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void) {
    this.listeners.delete(listener)
  }

  dispatch(nextVisibility: DocumentVisibilityState) {
    this.visibilityState = nextVisibility
    for (const listener of this.listeners) listener()
  }

  get listenerCount() {
    return this.listeners.size
  }
}

describe('foreground refresh subscription', () => {
  it('refreshes once per hidden-to-visible transition and cleans up Strict Mode remounts', () => {
    const source = new FakeVisibilitySource('visible')
    let blocked = false
    let refreshCount = 0

    const subscribe = () => subscribeToForegroundRefresh(
      source,
      () => blocked,
      () => { refreshCount += 1 },
    )

    const strictModeProbeCleanup = subscribe()
    strictModeProbeCleanup()
    const cleanup = subscribe()

    assert.equal(source.listenerCount, 1)
    source.dispatch('visible')
    source.dispatch('hidden')
    assert.equal(refreshCount, 0)

    source.dispatch('visible')
    source.dispatch('visible')
    assert.equal(refreshCount, 1)

    blocked = true
    source.dispatch('hidden')
    source.dispatch('visible')
    assert.equal(refreshCount, 1)

    blocked = false
    source.dispatch('hidden')
    source.dispatch('visible')
    assert.equal(refreshCount, 2)

    cleanup()
    source.dispatch('hidden')
    source.dispatch('visible')
    assert.equal(refreshCount, 2)
    assert.equal(source.listenerCount, 0)
  })

  it('refreshes when a tab mounted hidden becomes visible', () => {
    const source = new FakeVisibilitySource('hidden')
    let refreshCount = 0
    const cleanup = subscribeToForegroundRefresh(source, () => false, () => {
      refreshCount += 1
    })

    source.dispatch('visible')
    assert.equal(refreshCount, 1)
    cleanup()
  })
})
