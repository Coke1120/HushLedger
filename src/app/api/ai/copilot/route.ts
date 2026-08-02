import {
  aiCopilotInsightsResponseSchema,
  aiCopilotRequestSchema,
} from '../../../../lib/aiCopilot'
import { digestAiCopilotContext } from '../../../../lib/aiCopilotDigest'
import type {
  AiParseProviderSource,
  AiProviderSettings,
} from '../../../../lib/ai'
import { aiProviderFailure } from '../../../../server/ai'
import { askAiCopilot } from '../../../../server/aiCopilot'
import {
  getAiCopilotContext,
  listAiCopilotInsights,
} from '../../../../server/aiCopilotContext'
import { createAiCopilotReadRepository } from '../../../../server/aiCopilotReadRepository'
import { loadStableAiCopilotSnapshot } from '../../../../server/aiCopilotSnapshot'
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
  queryObject,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'
import { readLedgerRevision } from '../../../../server/money'
import { summaryQuerySchema } from '../../../../server/validation'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async (request) => {
  if (!isAuthenticatedApiRequest(request)) {
    return jsonError(403, 'ACCESS_FORBIDDEN', '無法驗證存取權限')
  }

  const parsed = summaryQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(
      400,
      'AI_COPILOT_INPUT_INVALID',
      'AI 助理月份查詢參數不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const env = await getCloudflareEnv()
  const repository = createAiCopilotReadRepository(env.DB)
  const stableSnapshot = await loadStableAiCopilotSnapshot(
    env.DB,
    () => listAiCopilotInsights(repository, parsed.data.month),
  )
  if (!stableSnapshot) return contextChangedResponse()

  const contextDigest = await digestAiCopilotContext(stableSnapshot.value.preview)
  return jsonSuccess(aiCopilotInsightsResponseSchema.parse({
    ...stableSnapshot.value,
    contextDigest,
  }))
})

export const POST = apiRoute(async (request) => {
  if (!isAuthenticatedApiRequest(request)) {
    return jsonError(403, 'ACCESS_FORBIDDEN', '無法驗證存取權限')
  }

  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = aiCopilotRequestSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'AI_COPILOT_INPUT_INVALID',
      'AI 助理請求資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const env = await getCloudflareEnv()
  try {
    const repository = createAiCopilotReadRepository(env.DB)
    const stableSnapshot = await loadStableAiCopilotSnapshot(
      env.DB,
      () => getAiCopilotContext(repository, parsed.data.month),
    )
    if (!stableSnapshot) return contextChangedResponse()

    const context = stableSnapshot.value
    const contextDigest = await digestAiCopilotContext(context)
    if (contextDigest !== parsed.data.expectedContextDigest) {
      return contextChangedResponse()
    }

    const provider = await resolveProvider(parsed.data.provider, env)
    if (provider instanceof Response) return provider
    if (await readLedgerRevision(env.DB) !== stableSnapshot.revision) {
      return contextChangedResponse()
    }

    const response = await askAiCopilot(
      {
        provider,
        locale: parsed.data.locale,
        prompt: parsed.data.prompt,
        context,
        contextDigest,
      },
      {
        allowLoopback: isLocalDevelopmentRequest(request),
        applicationOrigin: requestOrigin(request),
      },
    )
    if (await readLedgerRevision(env.DB) !== stableSnapshot.revision) {
      return contextChangedResponse()
    }
    return jsonSuccess(response)
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

export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound

function contextChangedResponse() {
  return jsonError(
    409,
    'AI_COPILOT_CONTEXT_CHANGED',
    'AI 助理資料預覽已過期，請重新檢視後再送出',
  )
}

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
