import { getDatabase } from '../../../../server/db'
import {
  apiRoute,
  apiNotFound,
  jsonError,
  jsonSuccess,
  queryObject,
  sanitizeValidationIssues,
} from '../../../../server/http'
import { listNetWorthTrend } from '../../../../server/money'
import { accountBalanceQuerySchema } from '../../../../server/validation'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async (request) => {
  const parsed = accountBalanceQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(
      400,
      'INVALID_QUERY',
      '資產淨值查詢不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }
  return jsonSuccess(await listNetWorthTrend(await getDatabase(), parsed.data.month))
})

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
