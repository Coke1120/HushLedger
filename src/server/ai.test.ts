import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AiProviderConnection, AiProviderSettings } from '../lib/ai'
import type { Category } from '../lib/schema'
import {
  AiProviderError,
  aiProviderFailure,
  listAiModels,
  parseBankStatement,
  resolveAiProviderEndpoint,
} from './ai'

const provider: AiProviderSettings = {
  baseUrl: 'https://provider.example/v1',
  apiKey: 'fictional-api-key-value',
  model: 'test-model',
}

const categories: Category[] = [
  {
    id: 3,
    name: '餐飲',
    type: 'expense',
    icon: 'utensils',
    color: '#000000',
    isActive: true,
    sortOrder: 1,
    localizationKey: 'category.food',
    updatedAt: '2026-07-11T10:30:00.000Z',
  },
]

const policy = {
  allowLoopback: false,
  applicationOrigin: 'https://ledger.example',
}

function completion(content: unknown) {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(content), refusal: null } }],
  })
}

describe('AI provider URL policy', () => {
  it('appends only fixed provider paths', () => {
    assert.equal(
      resolveAiProviderEndpoint('https://provider.example/v1/', 'models', policy).href,
      'https://provider.example/v1/models',
    )
    assert.equal(
      resolveAiProviderEndpoint('https://provider.example/v1', 'chat/completions', policy).href,
      'https://provider.example/v1/chat/completions',
    )
  })

  for (const baseUrl of [
    'http://provider.example/v1',
    'https://user:pass@provider.example/v1',
    'https://provider.example/v1?target=internal',
    'https://provider.example/v1#fragment',
    'https://provider.example:8443/v1',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://[::1]/v1',
    'https://provider.internal/v1',
    'https://single-label/v1',
    'https://ledger.example/v1',
  ]) {
    it(`rejects unsafe production URL ${baseUrl}`, () => {
      assert.throws(
        () => resolveAiProviderEndpoint(baseUrl, 'models', policy),
        (error) => error instanceof AiProviderError && error.code === 'CONFIG_INVALID',
      )
    })
  }

  it('allows loopback HTTP on a different port only for local use', () => {
    assert.equal(
      resolveAiProviderEndpoint('http://127.0.0.1:11434/v1', 'models', {
        allowLoopback: true,
        applicationOrigin: 'http://127.0.0.1:3000',
      }).href,
      'http://127.0.0.1:11434/v1/models',
    )
    assert.throws(() => resolveAiProviderEndpoint('http://192.168.1.20:11434/v1', 'models', {
      allowLoopback: true,
      applicationOrigin: 'http://127.0.0.1:3000',
    }))
    assert.throws(() => resolveAiProviderEndpoint('http://127.0.0.1:3000/v1', 'models', {
      allowLoopback: true,
      applicationOrigin: 'http://localhost:3000',
    }))
    assert.throws(() => resolveAiProviderEndpoint('http://localhost.:3000/v1', 'models', {
      allowLoopback: true,
      applicationOrigin: 'http://localhost:3000',
    }))
  })
})

describe('AI provider adapter', () => {
  it('loads unique model IDs with a minimal, non-redirecting request', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const models = await listAiModels(provider, {
      ...policy,
      fetcher: async (input, init) => {
        capturedUrl = String(input)
        capturedInit = init
        return Response.json({ data: [{ id: 'model-a' }, { id: 'model-a' }, { id: 'model-b' }] })
      },
    })

    assert.deepEqual(models, ['model-a', 'model-b'])
    assert.equal(capturedUrl, 'https://provider.example/v1/models')
    assert.equal(capturedInit?.method, 'GET')
    assert.equal(capturedInit?.redirect, 'error')
    assert.equal(capturedInit?.cache, 'no-store')
    const headers = new Headers(capturedInit?.headers)
    assert.equal(headers.get('authorization'), `Bearer ${provider.apiKey}`)
    assert.equal([...headers.keys()].sort().join(','), 'accept,authorization')
  })

  it('parses strict output and derives amount and category IDs on the server', async () => {
    let capturedBody = ''
    const drafts = await parseBankStatement(
      {
        provider,
        accountId: 2,
        dateOrder: 'DMY',
        statementText: 'Date Description Amount\n11/07/2026 Example merchant 123.45 DR',
        categories,
      },
      {
        ...policy,
        fetcher: async (_input, init) => {
          capturedBody = String(init?.body)
          return completion({
            rows: [{
              sourceLine: 2,
              occurredOn: '2026-07-11',
              direction: 'expense',
              amountText: '123.45',
              currency: 'HKD',
              description: 'Example merchant',
              suggestedCategoryName: '餐飲',
              confidence: 0.95,
              flags: [],
            }],
          })
        },
      },
    )

    assert.equal(drafts.length, 1)
    assert.equal(drafts[0]?.amountMinor, 12_345)
    assert.equal(drafts[0]?.accountId, 2)
    assert.equal(drafts[0]?.categoryId, 3)
    assert.equal(drafts[0]?.sourceText, '11/07/2026 Example merchant 123.45 DR')
    assert.match(drafts[0]?.importKey ?? '', /^ai:statement:row:[0-9a-f]{64}$/)
    assert.equal(capturedBody.includes(provider.apiKey), false)
    assert.equal(capturedBody.includes('accountId'), false)
    const body = JSON.parse(capturedBody) as {
      max_completion_tokens?: number
      max_tokens?: number
      response_format?: { json_schema?: { strict?: boolean } }
    }
    assert.equal(body.max_completion_tokens, 4_096)
    assert.equal(body.max_tokens, undefined)
    assert.equal(body.response_format?.json_schema?.strict, true)
  })

  it('keeps source keys stable while separating multiple drafts from one line', async () => {
    const rows = [
      {
        sourceLine: 1,
        occurredOn: '2026-07-11',
        direction: 'expense',
        amountText: '10.00',
        currency: 'HKD',
        description: 'First item',
        suggestedCategoryName: '餐飲',
        confidence: 0.9,
        flags: [],
      },
      {
        sourceLine: 1,
        occurredOn: '2026-07-11',
        direction: 'expense',
        amountText: '20.00',
        currency: 'HKD',
        description: 'Second item',
        suggestedCategoryName: '餐飲',
        confidence: 0.9,
        flags: [],
      },
    ] as const
    const input = {
      provider,
      accountId: 2,
      dateOrder: 'DMY' as const,
      statementText: '11/07/2026 Combined purchase 30.00 DR',
      categories,
    }
    const options = { ...policy, fetcher: async () => completion({ rows }) }

    const first = await parseBankStatement(input, options)
    const repeated = await parseBankStatement(input, options)

    assert.equal(first[0]?.importKey, repeated[0]?.importKey)
    assert.equal(first[1]?.importKey, repeated[1]?.importKey)
    assert.notEqual(first[0]?.importKey, first[1]?.importKey)
    assert.notEqual(first[0]?.id, repeated[0]?.id)
  })

  it('rejects malformed or authority-bearing model output', async () => {
    const invalidRows = [
      {
        sourceLine: 1,
        occurredOn: '2026-07-11',
        direction: 'expense',
        amountText: '1,234.50',
        currency: 'HKD',
        description: 'Merchant',
        suggestedCategoryName: null,
        confidence: 0.5,
        flags: [],
      },
      {
        sourceLine: 1,
        occurredOn: '2026-07-11',
        direction: 'expense',
        amountText: '12.00',
        amountMinor: 1_200,
        currency: 'HKD',
        description: 'Merchant',
        suggestedCategoryName: null,
        confidence: 0.5,
        flags: [],
      },
    ]

    for (const row of invalidRows) {
      await assert.rejects(
        parseBankStatement(
          {
            provider,
            accountId: 2,
            dateOrder: 'DMY',
            statementText: 'Merchant 12.00',
            categories,
          },
          { ...policy, fetcher: async () => completion({ rows: [row] }) },
        ),
        (error) => error instanceof AiProviderError && error.code === 'RESPONSE_INVALID',
      )
    }
  })

  it('caps declared and streamed provider responses', async () => {
    const declared = listAiModels(provider, {
      ...policy,
      fetcher: async () => new Response('{}', { headers: { 'content-length': '999999' } }),
    })
    await assert.rejects(declared, (error) =>
      error instanceof AiProviderError && error.code === 'RESPONSE_TOO_LARGE')

    const streamed = listAiModels(provider, {
      ...policy,
      fetcher: async () => new Response('x'.repeat(65 * 1024)),
    })
    await assert.rejects(streamed, (error) =>
      error instanceof AiProviderError && error.code === 'RESPONSE_TOO_LARGE')
  })

  for (const [status, code] of [[401, 'AUTH_FAILED'], [403, 'AUTH_FAILED'], [429, 'RATE_LIMITED'], [500, 'UNAVAILABLE']] as const) {
    it(`maps upstream ${status} without reading or returning its body`, async () => {
      const request = listAiModels(provider, {
        ...policy,
        fetcher: async () => new Response(`upstream body ${provider.apiKey}`, { status }),
      })
      await assert.rejects(request, (error) => {
        assert.equal(JSON.stringify(error).includes(provider.apiKey), false)
        return error instanceof AiProviderError && error.code === code
      })
    })
  }

  it('maps aborts to a generic timeout', async () => {
    const connection: AiProviderConnection = provider
    const request = listAiModels(connection, {
      ...policy,
      timeoutMs: 5,
      fetcher: async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    })
    await assert.rejects(request, (error) =>
      error instanceof AiProviderError && error.code === 'TIMEOUT')
  })

  it('keeps the timeout active while reading a stalled response body', async () => {
    const request = listAiModels(provider, {
      ...policy,
      timeoutMs: 5,
      fetcher: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":['))
        },
      })),
    })
    await assert.rejects(request, (error) =>
      error instanceof AiProviderError && error.code === 'TIMEOUT')
  })

  it('returns only generic local failure data', () => {
    const failure = aiProviderFailure(new AiProviderError('AUTH_FAILED'))
    assert.deepEqual(failure, {
      status: 502,
      code: 'AI_PROVIDER_AUTH_FAILED',
      message: 'AI provider 驗證失敗',
    })
    assert.equal(JSON.stringify(failure).includes(provider.apiKey), false)
  })
})
