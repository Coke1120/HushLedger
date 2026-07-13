import {
  accountTransferDeleteSchema,
  accountTransferUpdateSchema,
  transactionIdSchema,
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
  deleteAccountTransfer,
  getAccountTransfer,
  updateAccountTransfer,
  type UpdateAccountTransferResult,
} from '../../../../server/transfers'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = apiRoute(async (_request, context: RouteContext) => {
  const id = transactionIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidTransferId(id.error.issues)

  const transfer = await getAccountTransfer(await getDatabase(), id.data)
  return transfer
    ? jsonSuccess(transfer)
    : jsonError(404, 'TRANSFER_NOT_FOUND', '找不到指定的帳戶轉帳')
})

export const PUT = apiRoute(async (request, context: RouteContext) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const id = transactionIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidTransferId(id.error.issues)

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = accountTransferUpdateSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '帳戶轉帳資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return jsonTransferMutationResult(
    await updateAccountTransfer(await getDatabase(), id.data, parsed.data),
  )
})

export const DELETE = apiRoute(async (request, context: RouteContext) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const id = transactionIdSchema.safeParse((await context.params).id)
  if (!id.success) return invalidTransferId(id.error.issues)

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = accountTransferDeleteSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '刪除帳戶轉帳資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const result = await deleteAccountTransfer(await getDatabase(), id.data, parsed.data.updatedAt)
  if (result.kind === 'not_found') {
    return jsonError(404, 'TRANSFER_NOT_FOUND', '找不到指定的帳戶轉帳')
  }
  if (result.kind === 'version_conflict') {
    return jsonError(409, 'TRANSFER_VERSION_CONFLICT', '帳戶轉帳已被修改，請重新載入後再試')
  }
  return jsonSuccess({ id: result.id, deleted: true })
})

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound

function jsonTransferMutationResult(result: UpdateAccountTransferResult) {
  if (result.kind === 'not_found') {
    return jsonError(404, 'TRANSFER_NOT_FOUND', '找不到指定的帳戶轉帳')
  }
  if (result.kind === 'version_conflict') {
    return jsonError(409, 'TRANSFER_VERSION_CONFLICT', '帳戶轉帳已被修改，請重新載入後再試')
  }
  if (result.kind === 'reference_invalid') return jsonReferenceError('ACCOUNT_INVALID')
  return jsonSuccess(result.transfer)
}

function invalidTransferId(issues: Parameters<typeof sanitizeValidationIssues>[0]) {
  return jsonError(
    400,
    'INVALID_TRANSFER_ID',
    '帳戶轉帳 ID 不正確',
    sanitizeValidationIssues(issues),
  )
}
