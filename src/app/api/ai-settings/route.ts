import { z } from 'zod'
import { aiProviderSettingsWriteSchema } from '../../../lib/ai'
import { getCloudflareEnv } from '../../../server/db'
import {
  AiSettingsCryptoError,
  deleteAiProviderSettings,
  getAiProviderSettings,
  saveAiProviderSettings,
  type AiProviderSettingsDeleteResult,
  type AiProviderSettingsSaveResult,
} from '../../../server/aiSettings'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  isAuthenticatedApiRequest,
  jsonError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../server/http'

export const dynamic = 'force-dynamic'

const saveSchema = z
  .object({
    settings: aiProviderSettingsWriteSchema,
    expectedUpdatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()

const deleteSchema = z
  .object({ expectedUpdatedAt: z.string().datetime({ offset: true }) })
  .strict()

export const GET = apiRoute(async (request) => {
  if (!isAuthenticatedApiRequest(request)) return accessForbidden()
  return jsonSuccess(await getAiProviderSettings((await getCloudflareEnv()).DB))
})

export const PUT = apiRoute(async (request) => {
  if (!isAuthenticatedApiRequest(request)) return accessForbidden()
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response
  const parsed = saveSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      'AI provider 設定資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const env = await getCloudflareEnv()
  try {
    return saveResult(await saveAiProviderSettings(
      env.DB,
      parsed.data.settings,
      parsed.data.expectedUpdatedAt,
      env.AI_SETTINGS_ENCRYPTION_KEY_V1,
    ))
  } catch (error) {
    if (error instanceof AiSettingsCryptoError) return encryptionUnavailable()
    throw error
  }
})

export const DELETE = apiRoute(async (request) => {
  if (!isAuthenticatedApiRequest(request)) return accessForbidden()
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response
  const parsed = deleteSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      'AI provider 設定版本不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return deleteResult(await deleteAiProviderSettings(
    (await getCloudflareEnv()).DB,
    parsed.data.expectedUpdatedAt,
  ))
})

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound

function saveResult(result: AiProviderSettingsSaveResult) {
  if (result.kind === 'created') return jsonSuccess(result.settings, 201)
  if (result.kind === 'updated') return jsonSuccess(result.settings)
  if (result.kind === 'invalid_input') {
    return jsonError(400, 'AI_SETTINGS_INVALID', 'AI provider 設定資料不正確')
  }
  if (result.kind === 'api_key_required') {
    return jsonError(
      400,
      'AI_SETTINGS_API_KEY_REQUIRED',
      '建立設定或變更 provider 位址時必須提供 API key',
    )
  }
  return jsonError(409, 'AI_SETTINGS_VERSION_CONFLICT', 'AI provider 設定已被修改，請重新載入後再試')
}

function deleteResult(result: AiProviderSettingsDeleteResult) {
  if (result.kind === 'deleted') return jsonSuccess({ deleted: true })
  if (result.kind === 'not_found') {
    return jsonError(404, 'AI_SETTINGS_NOT_FOUND', '找不到 AI provider 設定')
  }
  return jsonError(409, 'AI_SETTINGS_VERSION_CONFLICT', 'AI provider 設定已被修改，請重新載入後再試')
}

function accessForbidden() {
  return jsonError(403, 'ACCESS_FORBIDDEN', '無法驗證存取權限')
}

function encryptionUnavailable() {
  return jsonError(500, 'AI_SETTINGS_ENCRYPTION_UNAVAILABLE', 'AI provider 設定加密服務目前無法使用')
}
