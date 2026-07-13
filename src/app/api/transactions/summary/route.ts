import { transactionQuerySchema } from '../../../../lib/schema'
import { getDatabase } from '../../../../server/db'
import {
  apiNotFound,
  apiRoute,
  jsonError,
  jsonSuccess,
  queryObject,
  sanitizeValidationIssues,
} from '../../../../server/http'
import { summarizeTransactions } from '../../../../server/money'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(async (request) => {
  const parsed = transactionQuerySchema.safeParse(queryObject(request))
  if (!parsed.success) {
    return jsonError(
      400,
      'INVALID_QUERY',
      '交易摘要查詢參數不正確',
      sanitizeValidationIssues(parsed.error.issues),
    )
  }

  return jsonSuccess(await summarizeTransactions(await getDatabase(), parsed.data))
})

export const HEAD = apiNotFound
export const POST = apiNotFound
export const PUT = apiNotFound
export const PATCH = apiNotFound
export const DELETE = apiNotFound
export const OPTIONS = apiNotFound
