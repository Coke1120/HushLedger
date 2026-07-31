import {
  MAX_AI_PARSE_REQUEST_BYTES,
  MAX_AI_STATEMENT_BYTES,
  aiParseRequestSchema,
  type AiParseProviderSource,
  type AiProviderSettings,
} from '../../../../lib/ai'
import { aiProviderFailure, parseBankStatement } from '../../../../server/ai'
import {
  AiSettingsCryptoError,
  getStoredAiProviderSettings,
} from '../../../../server/aiSettings'
import { getCloudflareEnv } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  isAuthenticatedApiRequest,
  isLocalDevelopmentRequest,
  jsonError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'
import { listAccounts, listCategories } from '../../../../server/money'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(async (request) => {
  if (!isAuthenticatedApiRequest(request)) {
    return jsonError(403, 'ACCESS_FORBIDDEN', '無法驗證存取權限')
  }

  const guarded = guardMutationRequest(request, MAX_AI_PARSE_REQUEST_BYTES)
  if (guarded) return guarded

  const body = await readApiJson(request, MAX_AI_PARSE_REQUEST_BYTES)
  if (!body.ok) return body.response

  const parsed = aiParseRequestSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'AI_PARSE_INPUT_INVALID',
      '銀行紀錄匯入資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }
  if (new TextEncoder().encode(parsed.data.statementText).byteLength > MAX_AI_STATEMENT_BYTES) {
    return jsonError(413, 'AI_STATEMENT_TOO_LARGE', '銀行紀錄文字不得超過 64 KiB')
  }

  const env = await getCloudflareEnv()
  const database = env.DB
  const [accounts, categories] = await Promise.all([
    listAccounts(database),
    listCategories(database),
  ])
  const account = accounts.find(
    (candidate) =>
      candidate.id === parsed.data.accountId &&
      candidate.isActive &&
      candidate.currency === parsed.data.currency,
  )
  if (!account) return jsonError(400, 'ACCOUNT_INVALID', '帳戶不存在、已停用或幣別不相符')

  try {
    const provider = await resolveProvider(parsed.data.provider, env)
    if (provider instanceof Response) return provider

    const drafts = await parseBankStatement(
      {
        provider,
        accountId: account.id,
        currency: parsed.data.currency,
        dateOrder: parsed.data.dateOrder,
        statementText: parsed.data.statementText,
        categories,
      },
      {
        allowLoopback: isLocalDevelopmentRequest(request),
        applicationOrigin: requestOrigin(request),
      },
    )
    return jsonSuccess({ drafts })
  } catch (error) {
    if (error instanceof AiSettingsCryptoError) {
      return jsonError(
        500,
        'AI_SETTINGS_ENCRYPTION_UNAVAILABLE',
        'AI provider 設定加密服務目前無法使用',
      )
    }
    const failure = aiProviderFailure(error)
    if (!failure) throw error
    return jsonError(failure.status, failure.code, failure.message)
  }
})

export const GET = apiNotFound
export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound

function requestOrigin(request: Request) {
  return request.headers.get('x-hushledger-access-verified') === 'true'
    ? (request.headers.get('x-hushledger-request-origin') ?? new URL(request.url).origin)
    : new URL(request.url).origin
}

async function resolveProvider(
  source: AiParseProviderSource,
  env: CloudflareEnv & { DB: D1Database },
): Promise<AiProviderSettings | Response> {
  if (source.source === 'transient') {
    return {
      baseUrl: source.baseUrl,
      apiKey: source.apiKey,
      model: source.model,
    }
  }

  const result = await getStoredAiProviderSettings(
    env.DB,
    env.AI_SETTINGS_ENCRYPTION_KEY_V1,
    source.expectedUpdatedAt,
  )
  if (result.kind === 'not_found') {
    return jsonError(404, 'AI_SETTINGS_NOT_FOUND', '找不到 AI provider 設定')
  }
  if (result.kind === 'version_conflict') {
    return jsonError(409, 'AI_SETTINGS_VERSION_CONFLICT', 'AI provider 設定已被修改，請重新載入後再試')
  }
  return result.settings
}
