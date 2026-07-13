import { transactionClearingBatchSchema } from '../../../../lib/schema'
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
import { setTransactionsClearing } from '../../../../server/money'

export const dynamic = 'force-dynamic'

export const PATCH = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response
  const parsed = transactionClearingBatchSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '批次交易狀態資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const result = await setTransactionsClearing(await getDatabase(), parsed.data)
  if (result.kind === 'version_conflict') {
    return jsonError(409, 'TRANSACTION_VERSION_CONFLICT', '交易已被修改，請重新載入後再試')
  }
  return jsonSuccess({ updated: result.count, cleared: parsed.data.cleared })
})

export const HEAD = apiNotFound
export const GET = apiNotFound
export const POST = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
