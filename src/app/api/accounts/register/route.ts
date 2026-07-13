import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  jsonError,
  jsonSuccess,
  queryObject,
  sanitizeValidationIssues,
} from '../../../../server/http'
import { getAccountRegister } from '../../../../server/accountRegister'
import { accountRegisterQuerySchema } from '../../../../server/validation'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async (request) => {
  const parsed = accountRegisterQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(
      400,
      'INVALID_QUERY',
      '帳戶流水帳查詢不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  const register = await getAccountRegister(
    await getDatabase(),
    parsed.data,
  )
  return register
    ? jsonSuccess(register)
    : jsonError(404, 'ACCOUNT_NOT_FOUND', '找不到帳戶')
})

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
