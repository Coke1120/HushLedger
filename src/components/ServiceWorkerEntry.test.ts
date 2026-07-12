import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GET } from '../app/sw.js/route'

describe('service worker entry route', () => {
  it('serves a fixed no-cache entry with a release marker and runtime import', async () => {
    const response = GET()
    const source = await response.text()

    assert.match(source, /globalThis\.__HUSHLEDGER_RELEASE_ID__ = /)
    assert.match(source, /importScripts\('\/sw-runtime\.js'\)/)
    assert.equal(response.headers.get('cache-control'), 'no-cache, no-store, must-revalidate')
    assert.equal(response.headers.get('service-worker-allowed'), '/')
  })
})
