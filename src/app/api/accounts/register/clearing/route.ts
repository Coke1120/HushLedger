import { accountRegisterClearingSchema } from '../../../../../lib/schema'
import {
  setAccountRegisterEntryClearing,
  type SetAccountRegisterEntryClearingResult,
} from '../../../../../server/accountRegister'
import { getDatabase } from '../../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  guardMutationRequest,
  jsonError,
  jsonSuccess,
  readApiJson,
  sanitizeValidationIssues,
} from '../../../../../server/http'

export const dynamic = 'force-dynamic'

export const PATCH = apiRoute(async (request) => {
  const guarded = guardMutationRequest(request)
  if (guarded) return guarded

  const body = await readApiJson(request)
  if (!body.ok) return body.response

  const parsed = accountRegisterClearingSchema.safeParse(body.data)
  if (!parsed.success) {
    return jsonError(
      400,
      'VALIDATION_ERROR',
      '流水帳清算狀態資料不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return jsonAccountRegisterClearingResult(
    await setAccountRegisterEntryClearing(await getDatabase(), parsed.data),
  )
})

export const HEAD = apiNotFound
export const GET = apiNotFound
export const POST = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound

function jsonAccountRegisterClearingResult(result: SetAccountRegisterEntryClearingResult) {
  if (result.kind === 'not_found') {
    return jsonError(404, 'REGISTER_ENTRY_NOT_FOUND', '找不到指定的流水帳項目')
  }
  if (result.kind === 'version_conflict') {
    return jsonError(409, 'REGISTER_ENTRY_VERSION_CONFLICT', '流水帳項目已被修改，請重新載入後再試')
  }
  if (result.kind === 'account_mismatch') {
    return jsonError(400, 'REGISTER_ENTRY_ACCOUNT_MISMATCH', '流水帳項目不屬於指定帳戶')
  }
  return jsonSuccess({
    id: result.id,
    updatedAt: result.updatedAt,
    cleared: result.cleared,
  })
}
