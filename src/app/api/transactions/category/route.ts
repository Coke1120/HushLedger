import {
  MAX_TRANSACTION_BATCH_REQUEST_BYTES,
  transactionCategoryBatchSchema,
} from '../../../../lib/schema'
import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonReferenceError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../server/http'
import { setTransactionsCategory } from '../../../../server/money'

export const dynamic = 'force-dynamic'

export const PATCH = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request, MAX_TRANSACTION_BATCH_REQUEST_BYTES)
  if (guarded) return guarded

  const body = await readApiJson(request, MAX_TRANSACTION_BATCH_REQUEST_BYTES)
  if (!body.ok) return body.response
  const parsed = transactionCategoryBatchSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '批次交易分類資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const result = await setTransactionsCategory(await getDatabase(), parsed.data)
  if (result.kind === 'version_conflict') {
    return jsonError(409, 'TRANSACTION_VERSION_CONFLICT', '交易已被修改，請重新載入後再試')
  }
  if (result.kind === 'reference_invalid') return jsonReferenceError(result.code)
  return jsonSuccess({ updated: result.count, categoryId: parsed.data.categoryId })
})

export const HEAD = apiNotFound
export const GET = apiNotFound
export const POST = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
