import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clearDevelopmentServiceWorkerState,
  isAppServiceWorkerEnabled,
  normalizeAppUpdateMode,
  resolveAppRestart,
  resolveControllerChange,
} from './appUpdate'

describe('app update preference', () => {
  it('accepts automatic updates and defaults every other value to manual', () => {
    assert.equal(normalizeAppUpdateMode('automatic'), 'automatic')
    assert.equal(normalizeAppUpdateMode('manual'), 'manual')
    assert.equal(normalizeAppUpdateMode('unexpected'), 'manual')
    assert.equal(normalizeAppUpdateMode(null), 'manual')
  })

  it('reloads only an armed update and flags updates activated by another tab', () => {
    assert.equal(resolveControllerChange(false, true, false), 'current')
    assert.equal(resolveControllerChange(true, true, false), 'restart-required')
    assert.equal(resolveControllerChange(true, true, true), 'reload')
  })

  it('defers every app restart while a ledger critical section is active', () => {
    assert.equal(resolveAppRestart(true), 'defer')
    assert.equal(resolveAppRestart(false), 'restart')
  })

  it('enables the offline worker only for production builds', () => {
    assert.equal(isAppServiceWorkerEnabled('production'), true)
    assert.equal(isAppServiceWorkerEnabled('development'), false)
    assert.equal(isAppServiceWorkerEnabled('test'), false)
    assert.equal(isAppServiceWorkerEnabled(undefined), false)
  })

  it('removes only HushLedger development worker state', async () => {
    const requestedScopes: string[] = []
    const deletedCaches: string[] = []
    let unregistered = 0

    const registrationState = await clearDevelopmentServiceWorkerState({
      async getRegistration(scope) {
        requestedScopes.push(scope)
        return {
          async unregister() {
            unregistered += 1
            return true
          },
        }
      },
    }, {
      async keys() {
        return [
          'hushledger-static-old',
          'hushledger-offline-old',
          'workbox-precache-v2-ledger',
          'unrelated-app-cache',
        ]
      },
      async delete(name) {
        deletedCaches.push(name)
        return true
      },
    })

    assert.deepEqual(requestedScopes, ['/'])
    assert.equal(unregistered, 1)
    assert.equal(registrationState, 'unregistered')
    assert.deepEqual(deletedCaches, [
      'hushledger-static-old',
      'hushledger-offline-old',
      'workbox-precache-v2-ledger',
    ])
  })

  it('keeps development cleanup best-effort when browser state is unavailable', async () => {
    const registrationState = await clearDevelopmentServiceWorkerState({
      async getRegistration() {
        throw new Error('registry unavailable')
      },
    }, {
      async keys() {
        throw new Error('cache storage unavailable')
      },
      async delete() {
        throw new Error('not reached')
      },
    })

    assert.equal(registrationState, 'failed')
  })

  it('distinguishes an already-retired worker from a cleanup failure', async () => {
    const registrationState = await clearDevelopmentServiceWorkerState({
      async getRegistration() {
        return undefined
      },
    })

    assert.equal(registrationState, 'none')
  })
})
