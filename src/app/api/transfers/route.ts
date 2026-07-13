import { accountTransferInputSchema, accountTransferQuerySchema } from '../../../lib/schema'
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
import { createAccountTransfer, listAccountTransfers } from '../../../server/transfers'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async (request) => {
  const parsed = accountTransferQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(
      400,
      'INVALID_QUERY',
      '帳戶轉帳查詢參數不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }
  return jsonSuccess(await listAccountTransfers(await getDatabase(), parsed.data))
})

export const POST = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = accountTransferInputSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '帳戶轉帳資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const result = await createAccountTransfer(await getDatabase(), parsed.data)
  if (result.kind === 'id_conflict') {
    return jsonError(409, 'ID_CONFLICT', '帳戶轉帳 ID 已用於另一筆資料')
  }
  if (result.kind === 'reference_invalid') return jsonReferenceError('ACCOUNT_INVALID')
  return jsonSuccess(result.transfer, result.kind === 'created' ? 201 : 200)
})

export const HEAD = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
