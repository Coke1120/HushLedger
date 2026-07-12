import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { before, describe, it } from 'node:test'

type ServiceWorkerPolicy = {
  isObsoleteCache: (name: string) => boolean
  offlineStaticAssetPaths: (html: string) => string[]
  shouldCacheStaticRequest: (request: { method: string; url: string }, origin: string) => boolean
  shouldUseOfflineFallback: (request: { method: string; mode: string }) => boolean
}

let policy: ServiceWorkerPolicy

before(async () => {
  await import(pathToFileURL(resolve('public/sw.js')).href)
  policy = (globalThis as typeof globalThis & {
    __HUSHLEDGER_SW_POLICY__: ServiceWorkerPolicy
  }).__HUSHLEDGER_SW_POLICY__
})

describe('service worker privacy policy', () => {
  it('caches only same-origin public and fingerprinted static assets', () => {
    const origin = 'https://ledger.example'
    assert.equal(policy.shouldCacheStaticRequest({ method: 'GET', url: `${origin}/_next/static/chunk.js` }, origin), true)
    assert.equal(policy.shouldCacheStaticRequest({ method: 'GET', url: `${origin}/pwa-192.png` }, origin), true)
    assert.equal(policy.shouldCacheStaticRequest({ method: 'GET', url: `${origin}/api/transactions` }, origin), false)
    assert.equal(policy.shouldCacheStaticRequest({ method: 'GET', url: `${origin}/?_rsc=private` }, origin), false)
    assert.equal(policy.shouldCacheStaticRequest({ method: 'POST', url: origin }, origin), false)
    assert.equal(policy.shouldCacheStaticRequest({ method: 'GET', url: 'https://other.example/pwa-192.png' }, origin), false)
  })

  it('uses the demo fallback only for failed document navigation', () => {
    assert.equal(policy.shouldUseOfflineFallback({ method: 'GET', mode: 'navigate' }), true)
    assert.equal(policy.shouldUseOfflineFallback({ method: 'GET', mode: 'cors' }), false)
    assert.equal(policy.shouldUseOfflineFallback({ method: 'POST', mode: 'navigate' }), false)
  })

  it('discovers only fingerprinted Next assets required by the offline shell', () => {
    const html = '<link href="/_next/static/app.css"><script src="/_next/static/app.js"></script><img src="/private-data.json">'
    assert.deepEqual(policy.offlineStaticAssetPaths(html), [
      '/_next/static/app.css',
      '/_next/static/app.js',
    ])
  })

  it('cleans old Workbox and versioned HushLedger caches only', () => {
    assert.equal(policy.isObsoleteCache('workbox-precache-v2-example'), true)
    assert.equal(policy.isObsoleteCache('hushledger-static-v0'), true)
    assert.equal(policy.isObsoleteCache('hushledger-static-v1'), false)
    assert.equal(policy.isObsoleteCache('unrelated-app'), false)
  })
})
