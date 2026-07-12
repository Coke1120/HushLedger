import {
  transactionDeleteSchema,
  transactionIdSchema,
  transactionUpdateSchema,
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
import {
  deleteTransaction,
  getTransaction,
  updateTransaction,
  type UpdateTransactionResult,
} from '../../../../server/money'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = apiRoute(async (_request, context: RouteContext) => {
  const id = transactionIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidTransactionId(id.error.issues)

  const transaction = await getTransaction(await getDatabase(), id.data)
  return transaction
    ? jsonSuccess(transaction)
    : jsonError(404, 'TRANSACTION_NOT_FOUND', '找不到指定的交易')
})

export const PUT = apiRoute(async (request, context: RouteContext) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const id = transactionIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidTransactionId(id.error.issues)

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = transactionUpdateSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '交易資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return jsonTransactionMutationResult(
    await updateTransaction(await getDatabase(), id.data, parsed.data),
  )
})

export const DELETE = apiRoute(async (request, context: RouteContext) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const id = transactionIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidTransactionId(id.error.issues)

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = transactionDeleteSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '刪除交易資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const result = await deleteTransaction(await getDatabase(), id.data, parsed.data.updatedAt)
  if (result.kind === 'not_found') {
    return jsonError(404, 'TRANSACTION_NOT_FOUND', '找不到指定的交易')
  }
  if (result.kind === 'version_conflict') {
    return jsonError(409, 'TRANSACTION_VERSION_CONFLICT', '交易已被修改，請重新載入後再試')
  }
  return jsonSuccess({ id: result.id, deleted: true })
})

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound

function jsonTransactionMutationResult(result: UpdateTransactionResult) {
  if (result.kind === 'not_found') {
    return jsonError(404, 'TRANSACTION_NOT_FOUND', '找不到指定的交易')
  }
  if (result.kind === 'version_conflict') {
    return jsonError(409, 'TRANSACTION_VERSION_CONFLICT', '交易已被修改，請重新載入後再試')
  }
  if (result.kind === 'reference_invalid') return jsonReferenceError(result.code)
  return jsonSuccess(result.transaction)
}

function invalidTransactionId(issues: Parameters<typeof sanitizeValidationIssues>[0]) {
  return jsonError(
    400,
    'INVALID_TRANSACTION_ID',
    '交易 ID 不正確',
    sanitizeValidationIssues(issues),
  )
}
