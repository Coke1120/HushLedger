import {
  MAX_AI_MODELS_REQUEST_BYTES,
  aiModelsRequestSchema,
  type AiModelsProviderSource,
  type AiProviderConnection,
} from '../../../../lib/ai'
import { aiProviderFailure, listAiModels } from '../../../../server/ai'
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

export const dynamic = 'force-dynamic'

export const POST = apiRoute(async (request) => {
  if (!isAuthenticatedApiRequest(request)) {
    return jsonError(403, 'ACCESS_FORBIDDEN', '無法驗證存取權限')
  }

  const guarded = guardMutationRequest(request, MAX_AI_MODELS_REQUEST_BYTES)
  if (guarded) return guarded

  const body = await readApiJson(request, MAX_AI_MODELS_REQUEST_BYTES)
  if (!body.ok) return body.response

  const parsed = aiModelsRequestSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'AI_PROVIDER_CONFIG_INVALID',
      'AI provider 設定不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  try {
    const provider = await resolveProvider(parsed.data.provider)
    if (provider instanceof Response) return provider

    const models = await listAiModels(provider, {
      allowLoopback: isLocalDevelopmentRequest(request),
      applicationOrigin: requestOrigin(request),
    })
    return jsonSuccess(models)
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
  source: AiModelsProviderSource,
): Promise<AiProviderConnection | Response> {
  if (source.source === 'transient') {
    return { baseUrl: source.baseUrl, apiKey: source.apiKey }
  }

  const env = await getCloudflareEnv()
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
