import { transactionInputSchema, transactionQuerySchema } from '../../../lib/schema'
import { getDatabase } from '../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonReferenceError,
  jsonSuccess,
  queryObject,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../server/http'
import { createTransaction, listTransactions } from '../../../server/money'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async (request) => {
  const parsed = transactionQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(
      400,
      'INVALID_QUERY',
      '交易查詢參數不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return jsonSuccess(await listTransactions(await getDatabase(), parsed.data))
})

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = transactionInputSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '交易資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const result = await createTransaction(await getDatabase(), parsed.data)
  if (result.kind === 'id_conflict') {
    return jsonError(409, 'ID_CONFLICT', '交易 ID 已用於另一筆資料')
  }
  if (result.kind === 'reference_invalid') return jsonReferenceError(result.code)
  return jsonSuccess(result.transaction, result.kind === 'created' ? 201 : 200)
})

export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
