import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import {
  apiRoute,
  guardMutationRequest,
  isLocalDevelopmentRequest,
  MAX_JSON_BODY_BYTES,
  queryObject,
  readApiJson,
} from './http'

afterEach(() => {
  mock.restoreAll()
})

describe('API request helpers', () => {
  it('preserves duplicate query values so strict schemas reject ambiguity', () => {
    const request = new Request('https://ledger.example/api/transactions?month=2026-07&month=2026-08')

    assert.deepEqual(queryObject(request), { month: ['2026-07', '2026-08'] })
  })

  for (const url of ['http://localhost:3000', 'http://127.0.0.1:8787', 'http://[::1]:8787']) {
    it(`recognizes explicit local development host ${url}`, () => {
      assert.equal(isLocalDevelopmentRequest(new Request(url)), true)
    })
  }

  it('requires same-origin writes before reading a body', async () => {
    const missing = guardMutationRequest(new Request('https://ledger.example/api/transactions'))
    const crossOrigin = guardMutationRequest(new Request('https://ledger.example/api/transactions', {
      headers: { origin: 'https://attacker.example' },
    }))

    assert.equal(missing?.status, 403)
    const missingBody = await missing?.json() as { error?: { code?: string } } | undefined
    assert.equal(missingBody?.error?.code, 'ORIGIN_FORBIDDEN')
    assert.equal(crossOrigin?.status, 403)
  })

  it('uses the custom Worker origin after OpenNext normalizes the internal host', () => {
    const request = new Request('http://localhost:8787/api/transactions', {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:8787',
        'x-hushledger-access-verified': 'true',
        'x-hushledger-request-origin': 'http://127.0.0.1:8787',
      },
    })

    assert.equal(guardMutationRequest(request), null)
  })

  it('rejects oversized declared and streamed JSON bodies', async () => {
    const declared = guardMutationRequest(new Request('https://ledger.example/api/transactions', {
      headers: {
        origin: 'https://ledger.example',
        'content-length': String(MAX_JSON_BODY_BYTES + 1),
      },
    }))
    assert.equal(declared?.status, 413)

    const streamed = await readApiJson(new Request('https://ledger.example/api/transactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(MAX_JSON_BODY_BYTES) }),
    }))
    assert.equal(streamed.ok, false)
    if (!streamed.ok) {
      assert.equal(streamed.response.status, 413)
      const streamedBody = await streamed.response.json() as { error?: { code?: string } }
      assert.equal(streamedBody.error?.code, 'PAYLOAD_TOO_LARGE')
    }
  })

  it('distinguishes unsupported media types from invalid JSON', async () => {
    const unsupported = await readApiJson(new Request('https://ledger.example/api/transactions', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    }))
    const invalid = await readApiJson(new Request('https://ledger.example/api/transactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: '{',
    }))

    assert.equal(unsupported.ok, false)
    assert.equal(invalid.ok, false)
    if (!unsupported.ok && !invalid.ok) {
      assert.equal(unsupported.response.status, 415)
      assert.equal(invalid.response.status, 400)
    }
  })

  it('logs only generic request metadata and never leaks thrown details', async () => {
    const error = mock.method(console, 'error', () => undefined)
    const route = apiRoute(async () => {
      throw new Error('secret database detail')
    })

    const response = await route(new Request('https://ledger.example/api/health'))

    assert.equal(response.status, 500)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(await response.json(), {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '伺服器暫時無法處理請求' },
    })
    assert.deepEqual(error.mock.calls[0]?.arguments, ['request_failed', { method: 'GET' }])
    assert.ok(!JSON.stringify(error.mock.calls).includes('secret database detail'))
  })
})
