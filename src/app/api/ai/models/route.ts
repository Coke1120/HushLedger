import { MAX_AI_MODELS_REQUEST_BYTES, aiModelsRequestSchema } from '../../../../lib/ai'
import { aiProviderFailure, listAiModels } from '../../../../server/ai'
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
    const models = await listAiModels(parsed.data.provider, {
      allowLoopback: isLocalDevelopmentRequest(request),
      applicationOrigin: requestOrigin(request),
    })
    return jsonSuccess(models)
  } catch (error) {
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
