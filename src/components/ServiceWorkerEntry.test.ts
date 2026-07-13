import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GET, serviceWorkerEntryForEnvironment } from '../app/sw.js/route'

describe('service worker entry route', () => {
  it('serves the production runtime with a release marker', () => {
    const source = serviceWorkerEntryForEnvironment('production', 'release-123')

    assert.match(source, /globalThis\.__HUSHLEDGER_RELEASE_ID__ = "release-123"/)
    assert.match(source, /importScripts\('\/sw-runtime\.js'\)/)
    assert.doesNotMatch(source, /unregister\(\)/)
  })

  it('serves a development cleanup worker instead of the offline runtime', () => {
    const source = serviceWorkerEntryForEnvironment('development', 'ignored-release')

    assert.match(source, /skipWaiting\(\)/)
    assert.match(source, /registration\.unregister\(\)/)
    assert.match(source, /hushledger-/)
    assert.match(source, /workbox-/)
    assert.match(source, /clients\.matchAll/)
    assert.match(source, /client\.navigate/)
    assert.doesNotMatch(source, /importScripts/)
    assert.doesNotMatch(source, /addEventListener\('fetch'/)
  })

  it('keeps the environment-specific entry uncacheable', async () => {
    const response = GET()
    const source = await response.text()

    assert(source.length > 0)
    assert.equal(response.headers.get('cache-control'), 'no-cache, no-store, must-revalidate')
    assert.equal(response.headers.get('service-worker-allowed'), '/')
  })
})
