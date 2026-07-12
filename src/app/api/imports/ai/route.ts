import {
  MAX_AI_IMPORT_REQUEST_BYTES,
  aiImportRequestSchema,
} from '../../../../lib/ai'
import {
  commitTransactionImport,
  isTransactionImportConflict,
  previewTransactionImport,
} from '../../../../server/transactionImport'
import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request, MAX_AI_IMPORT_REQUEST_BYTES)
  if (guarded) return guarded

  const body = await readApiJson(request, MAX_AI_IMPORT_REQUEST_BYTES)
  if (!body.ok) return body.response

  const parsed = aiImportRequestSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      'AI 草稿匯入資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const database = await getDatabase()
  if (parsed.data.mode === 'preview') {
    return jsonSuccess(await previewTransactionImport(database, parsed.data.rows))
  }

  try {
    const outcome = await commitTransactionImport(database, parsed.data.rows)
    if (outcome.kind === 'blocked') {
      return jsonError(409, 'AI_IMPORT_BLOCKED', '部分草稿已失效，請重新檢查')
    }
    return jsonSuccess(outcome.result, outcome.result.imported > 0 ? 201 : 200)
  } catch (error) {
    if (isTransactionImportConflict(error)) {
      return jsonError(409, 'AI_IMPORT_STALE', '草稿狀態已改變，請重新檢查')
    }
    throw error
  }
})

export const GET = apiNotFound
export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
