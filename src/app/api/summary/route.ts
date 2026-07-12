import { getDatabase } from '../../../server/db'
import {
  apiNotFound,
  apiRoute,
  jsonError,
  jsonSuccess,
  queryObject,
  sanitizeValidationIssues,
} from '../../../server/http'
import { getSummary } from '../../../server/money'
import { summaryQuerySchema } from '../../../server/validation'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async (request) => {
  const parsed = summaryQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(
      400,
      'INVALID_QUERY',
      '月份查詢參數不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return jsonSuccess(await getSummary(await getDatabase(), parsed.data.month))
})

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
